const NATIVE_HOST_NAME = "vlc_opener";
const tracker = createStreamTracker();

browser.webRequest.onBeforeSendHeaders.addListener((details) => {
  tracker.trackRequest(details.requestId, details.tabId, details.url, details.requestHeaders);
}, { urls: ["<all_urls>"] }, ["requestHeaders"]);

browser.webRequest.onHeadersReceived.addListener((details) => {
  const recorded = tracker.recordResponse(details.requestId, details.tabId, details.url, details.statusCode, details.responseHeaders);
  if (recorded && details.tabId >= 0) {
    browser.action.setBadgeText({ tabId: details.tabId, text: "▶" });
    browser.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#e66014" });
    browser.tabs.sendMessage(details.tabId, { action: "STREAM_DETECTED" }).catch(() => {});
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
      notify("VLC Opener", "Buffering Episode " + meta.nextEpisode.number + " into playlist...");
      const queueRes = await sendUrlToVlc(meta.nextEpisode.url, tab.url, false, true);
      if (queueRes?.ok) notify("VLC Opener", "Enqueued Episode " + meta.nextEpisode.number + " into VLC playlist.");
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
