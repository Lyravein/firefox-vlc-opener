function createStreamTracker() {
  const tabs = new Map();
  const pendingRequests = new Map();

  function isIgnoredUrl(url) {
    return !url || /\.(ts|m4s|aac|vtt)(\?.*)?$/i.test(url) || /[?&](range|segment)=/i.test(url);
  }

  function getStreamType(url, contentType = "") {
    if (/\.(m3u8|mpd)(\?.*)?$/i.test(url) || /mpegurl|dash\+xml/i.test(contentType)) return "playlist";
    if (/\.(mp4|webm|mkv|mov)(\?.*)?$/i.test(url) || contentType.startsWith("video/")) return "direct";
    return null;
  }

  function trackRequest(requestId, tabId, url, requestHeaders = []) {
    if (!requestId || tabId < 0 || isIgnoredUrl(url)) return;
    let referer = "";
    let range;
    for (const header of requestHeaders) {
      const name = header.name.toLowerCase();
      if (name === "referer") referer = header.value;
      if (name === "range") range = header.value;
    }
    const pending = { tabId, url, referer, hasRange: Boolean(range), timestamp: Date.now() };
    pendingRequests.set(requestId, pending);
    setTimeout(() => {
      if (pendingRequests.get(requestId) === pending) pendingRequests.delete(requestId);
    }, 60000);
  }

  function recordResponse(requestId, tabId, url, statusCode, responseHeaders = []) {
    const pending = pendingRequests.get(requestId);
    pendingRequests.delete(requestId);
    if (statusCode === 206 || pending?.hasRange || isIgnoredUrl(url)) return false;
    let contentType = "";
    for (const header of responseHeaders) {
      if (header.name.toLowerCase() === "content-type") contentType = header.value;
    }
    const type = getStreamType(url, contentType);
    if (!type) return false;
    let entry = tabs.get(tabId);
    if (!entry) {
      entry = { playlist: null, direct: null };
      tabs.set(tabId, entry);
    }
    const record = { url, referer: pending?.referer || "", type, timestamp: Date.now() };
    if (type === "playlist") entry.playlist = record;
    else entry.direct = record;
    return true;
  }

  function getBestStream(tabId) {
    const entry = tabs.get(tabId);
    return entry?.playlist || entry?.direct || null;
  }

  function cleanupRequest(requestId) {
    pendingRequests.delete(requestId);
  }

  function cleanupTab(tabId) {
    tabs.delete(tabId);
    for (const [requestId, data] of pendingRequests) {
      if (data.tabId === tabId) pendingRequests.delete(requestId);
    }
  }

  return { trackRequest, recordResponse, getBestStream, cleanupRequest, cleanupTab };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createStreamTracker };
}
