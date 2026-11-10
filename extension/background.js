const NATIVE_HOST_NAME = "vlc_opener";
const tracker = createStreamTracker();
let activePrefetchJob = null;
const tabStreamResolvers = new Map();

browser.webRequest.onBeforeSendHeaders.addListener((details) => {
  tracker.trackRequest(details.requestId, details.tabId, details.url, details.requestHeaders);
}, { urls: ["<all_urls>"] }, ["requestHeaders"]);

browser.webRequest.onHeadersReceived.addListener((details) => {
  const recorded = tracker.recordResponse(details.requestId, details.tabId, details.url, details.statusCode, details.responseHeaders);
  if (recorded && details.tabId >= 0) {
    browser.action.setBadgeText({ tabId: details.tabId, text: "▶" });
    browser.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#e66014" });
    browser.tabs.sendMessage(details.tabId, { action: "STREAM_DETECTED" }).catch(() => {});
    const resolver = tabStreamResolvers.get(details.tabId);
    if (resolver) {
      tabStreamResolvers.delete(details.tabId);
      resolver(tracker.getBestStream(details.tabId));
    }
  }
}, { urls: ["<all_urls>"] }, ["responseHeaders"]);

browser.webRequest.onCompleted.addListener((details) => tracker.cleanupRequest(details.requestId), { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener((details) => tracker.cleanupRequest(details.requestId), { urls: ["<all_urls>"] });
browser.tabs.onRemoved.addListener((tabId) => tracker.cleanupTab(tabId));
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tracker.cleanupTab(tabId);
    browser.action.setBadgeText({ tabId, text: "" });
  }
});

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({ id: "vlc-open-media", title: "Open in VLC", contexts: ["link", "video", "audio", "page"] });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "vlc-open-media") return;
  const candidate = info.srcUrl || info.linkUrl || info.pageUrl || tab?.url;
  if (candidate) sendUrlToVlc(candidate, tab?.url || candidate, false);
  else notify("VLC Opener", "No media URL found in clicked target.");
});

function findPageVideoUrl() {
  const video = Array.from(document.querySelectorAll("video")).find(v => v.currentSrc || v.src);
  return video ? { found: true, url: video.currentSrc || video.src } : { found: false };
}

async function prefetchNextEpisodeStream(nextEpisodeUrl, timeoutMs = 15000) {
  if (activePrefetchJob) return null;
  activePrefetchJob = nextEpisodeUrl;
  let tab = null;
  let onUpdatedListener = null;
  let onRemovedListener = null;
  let timer = null;

  try {
    tab = await browser.tabs.create({ url: nextEpisodeUrl, active: false });
    await browser.tabs.update(tab.id, { muted: true }).catch(() => {});

    const existing = tracker.getBestStream(tab.id);
    if (existing) return existing;

    onUpdatedListener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === "complete") {
        browser.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const v = document.querySelector("video");
            if (v) v.play().catch(() => {});
            const btn = document.querySelector(".play-button, [aria-label*='play' i], .vjs-big-play-button");
            if (btn) btn.click();
          }
        }).catch(() => {});
      }
    };
    browser.tabs.onUpdated.addListener(onUpdatedListener);

    onRemovedListener = (tabId) => {
      if (tabId === tab.id) {
        const r = tabStreamResolvers.get(tab.id);
        if (r) {
          tabStreamResolvers.delete(tab.id);
          r(null);
        }
      }
    };
    browser.tabs.onRemoved.addListener(onRemovedListener);

    const streamPromise = new Promise((resolve) => {
      tabStreamResolvers.set(tab.id, resolve);
    });
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        tabStreamResolvers.delete(tab.id);
        resolve(null);
      }, timeoutMs);
    });

    const stream = await Promise.race([streamPromise, timeoutPromise]);
    clearTimeout(timer);
    return stream;
  } finally {
    if (onUpdatedListener) browser.tabs.onUpdated.removeListener(onUpdatedListener);
    if (onRemovedListener) browser.tabs.onRemoved.removeListener(onRemovedListener);
    if (tab && tab.id) {
      await browser.tabs.remove(tab.id).catch(() => {});
      tracker.cleanupTab(tab.id);
    }
    activePrefetchJob = null;
  }
}

async function handleVlcTrigger(tab, meta = {}) {
  if (!tab || !tab.id) return;
  let launchResult = null;
  const best = tracker.getBestStream(tab.id);
  if (best) {
    launchResult = await sendUrlToVlc(best.url, best.referer, true, false);
  } else {
    try {
      const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: findPageVideoUrl });
      const outcome = results[0]?.result;
      if (outcome?.found) launchResult = await sendUrlToVlc(outcome.url, tab.url, true, false);
      else launchResult = await sendUrlToVlc(tab.url, tab.url, false, false);
    } catch {
      launchResult = await sendUrlToVlc(tab.url, tab.url, false, false);
    }
  }
  if (launchResult?.ok) {
    if (meta.nextEpisode && meta.nextEpisode.url) {
      notify("VLC Opener", "Pre-fetching Episode " + meta.nextEpisode.number + " in background...");
      const captured = await prefetchNextEpisodeStream(meta.nextEpisode.url, 15000);
      if (captured && captured.url) {
        const queueRes = await sendUrlToVlc(captured.url, captured.referer || meta.nextEpisode.url, true, true);
        if (queueRes?.ok) notify("VLC Opener", "Enqueued Episode " + meta.nextEpisode.number + " into VLC playlist.");
      } else {
        notify("VLC Opener", "Resolving Episode " + meta.nextEpisode.number + " via yt-dlp fallback...");
        const queueRes = await sendUrlToVlc(meta.nextEpisode.url, tab.url, false, true);
        if (queueRes?.ok) notify("VLC Opener", "Enqueued Episode " + meta.nextEpisode.number + " into VLC playlist.");
      }
    } else if (meta.isLast) {
      notify("VLC Opener", "There's no episode left! (Enjoy the final episode)");
    }
  }
}

browser.action.onClicked.addListener((tab) => handleVlcTrigger(tab, {}));

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "GET_STREAM_STATUS") {
    const tabId = sender.tab ? sender.tab.id : null;
    const best = tabId ? tracker.getBestStream(tabId) : null;
    sendResponse({ hasStream: Boolean(best) });
    return;
  }
  if (message.action === "TRIGGER_VLC") {
    const tab = sender.tab;
    if (tab) handleVlcTrigger(tab, message);
  }
});

function truncateUrl(url) {
  return url.length > 45 ? url.slice(0, 42) + "..." : url;
}

function notify(title, message) {
  browser.notifications.create({ type: "basic", iconUrl: "icons/icon-48.png", title, message });
}

async function sendUrlToVlc(url, referer = null, isDirect = false, enqueue = false) {
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { url, referer, is_direct: isDirect, enqueue });
    if (response.success) {
      if (!enqueue) notify("VLC Opener", "Launching VLC for: " + truncateUrl(response.url || url));
      return { ok: true, response };
    }
    notify("VLC Opener", response.error || "Failed to launch VLC.");
    return { ok: false, response };
  } catch (error) {
    notify("VLC Opener", error.message);
    return { ok: false, response: { error: error.message } };
  }
}
