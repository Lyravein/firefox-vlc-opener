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

browser.action.onClicked.addListener(async (tab) => {
  const best = tracker.getBestStream(tab.id);
  if (best) {
    sendUrlToVlc(best.url, best.referer, true);
    return;
  }
  try {
    const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: findPageVideoUrl });
    const outcome = results[0]?.result;
    if (outcome?.found) sendUrlToVlc(outcome.url, tab.url, true);
    else sendUrlToVlc(tab.url, tab.url, false);
  } catch {
    sendUrlToVlc(tab.url, tab.url, false);
  }
});

function truncateUrl(url) {
  return url.length > 45 ? url.slice(0, 42) + "..." : url;
}

function notify(title, message) {
  browser.notifications.create({ type: "basic", iconUrl: "icons/icon-48.png", title, message });
}

async function sendUrlToVlc(url, referer = null, isDirect = false) {
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { url, referer, is_direct: isDirect });
    if (response.success) notify("VLC Opener", "Launching VLC for: " + truncateUrl(response.url || url));
    else notify("VLC Opener", response.error);
  } catch (error) {
    notify("VLC Opener", error.message);
  }
}
