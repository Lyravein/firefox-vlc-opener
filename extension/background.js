const NATIVE_HOST_NAME = "vlc_opener";
const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".m3u8", ".mpd", ".webm", ".mkv", ".avi", ".flv", ".mov",
  ".ogg", ".ogv", ".ts", ".mp3", ".m4a", ".aac", ".wav", ".flac", ".opus"
]);

function hasMediaExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.slice(pathname.lastIndexOf("/") + 1).match(/\\.[^.]+$/)?.[0].toLowerCase();
    return MEDIA_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "vlc-open-media",
    title: "Open in VLC",
    contexts: ["link", "video", "audio"]
  });
});

browser.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== "vlc-open-media") return;

  const candidate = info.srcUrl || info.linkUrl;
  if (candidate) {
    if (!hasMediaExtension(candidate)) {
      notify("VLC Opener", "URL does not have an allowed direct media extension");
      return;
    }
    sendUrlToVlc(candidate);
  } else {
    notify("VLC Opener", "No media URL found in clicked target.");
  }
});

function findPageVideoUrl() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length === 0) {
    return { found: false, error: "No video element found on this page." };
  }

  const activeVideo = videos.find(v => !v.paused && v.currentTime > 0) || videos.find(v => v.currentSrc || v.src) || videos[0];
  if (activeVideo.mediaKeys) {
    return { found: false, error: "Video uses DRM (EME/mediaKeys). Cannot open encrypted streams in VLC." };
  }

  const rawUrl = activeVideo.currentSrc || activeVideo.src || activeVideo.querySelector("source")?.src;
  if (!rawUrl) {
    return { found: false, error: "Video element has no readable source." };
  }
  if (rawUrl.startsWith("blob:") || rawUrl.startsWith("data:")) {
    return { found: false, error: "Video uses encrypted or blob MSE stream. Only direct URLs (.mp4, .m3u8, .mpd) can be opened in VLC." };
  }

  return { found: true, url: rawUrl };
}

browser.action.onClicked.addListener(async (tab) => {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: findPageVideoUrl
    });
    const outcome = results[0]?.result;
    if (outcome?.found) {
      if (!hasMediaExtension(outcome.url)) {
        notify("VLC Opener", "URL does not have an allowed direct media extension");
        return;
      }
      sendUrlToVlc(outcome.url);
    } else {
      notify("VLC Opener", outcome?.error || "Unable to detect a video URL.");
    }
  } catch (error) {
    notify("VLC Opener", error.message);
  }
});

function truncateUrl(url) {
  return url.length > 45 ? url.slice(0, 42) + "..." : url;
}

function notify(title, message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-48.png",
    title,
    message
  });
}

async function sendUrlToVlc(url) {
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { url });
    if (response.success) {
      notify("VLC Opener", "Launching VLC for: " + truncateUrl(url));
    } else {
      notify("VLC Opener", response.error);
    }
  } catch (error) {
    notify("VLC Opener", error.message);
  }
}
