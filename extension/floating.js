if (window.__vlc_opener_injected) return;
window.__vlc_opener_injected = true;

if (window.self !== window.top && (window.innerWidth < 150 || window.innerHeight < 150)) {
  return;
}

const host = document.createElement("div");
host.id = "vlc-opener-floating-root";
const shadow = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent = `
  :host { position: fixed; bottom: 24px; right: 24px; z-index: 2147483647; }
  .container { display: flex; flex-direction: column; align-items: center; }
  .ep-pill { display: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; font-weight: 600; color: #f8fafc; background: #1a1e28; border: 1px solid #e66014; border-radius: 999px; padding: 2px 7px; margin-bottom: 4px; text-align: center; white-space: nowrap; user-select: none; pointer-events: none; }
  .ep-pill.visible { display: block; }
  .ep-pill.final { border-color: #94a3b8; color: #cbd5e1; }
  button { position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 2px solid #e66014; border-radius: 50%; background: #1a1e28; color: white; cursor: pointer; transition: transform 120ms ease, border-color 120ms ease; }
  button:hover { transform: scale(1.08); border-color: #ff812e; }
  button.active { border-color: #22c55e; box-shadow: 0 0 12px #22c55e99; }
  .badge { display: none; position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; }
  button.active .badge { display: block; animation: pulse 1.4s infinite; }
  @keyframes pulse { 50% { opacity: .45; transform: scale(.8); } }
`;
const container = document.createElement("div");
container.className = "container";
const pill = document.createElement("div");
pill.className = "ep-pill";
const button = document.createElement("button");
button.type = "button";
button.title = "Open in VLC (Drag to move)";
button.setAttribute("aria-label", "Open in VLC");
button.innerHTML = '<svg width="25" height="30" viewBox="0 0 24 30" aria-hidden="true"><path fill="#fff" d="M4 2h16l-2 5H6z"/><path fill="#e66014" d="M6 8h12l-2 5H8z"/><path fill="#fff" d="M8 14h8l-2 5h-4z"/><path fill="#e66014" d="M10 20h4l-2 7z"/></svg><span class="badge"></span>';
container.append(pill, button);
shadow.append(style, container);

function scanPageEpisodes() {
  if (typeof parseEpisodes !== "function") return { episodes: [], currentEpisode: null, totalEpisodes: 0, nextEpisode: null };
  return parseEpisodes({
    url: window.location.href,
    title: document.title,
    links: Array.from(document.querySelectorAll("a[href]")).map(a => ({ href: a.href, text: a.textContent || "", className: a.className || "" })),
    options: Array.from(document.querySelectorAll("select option")).map(o => ({ value: o.value || "", text: o.textContent || "", selected: Boolean(o.selected) }))
  });
}

function updateEpisodeBadge(info) {
  if (info.totalEpisodes >= 2) {
    pill.textContent = `Ep ${info.currentEpisode || "?"} / ${info.totalEpisodes}`;
    pill.title = `Episode ${info.currentEpisode || "?"} of ${info.totalEpisodes}`;
    pill.classList.add("visible");
    if (info.currentEpisode === info.totalEpisodes) pill.classList.add("final");
    else pill.classList.remove("final");
  } else {
    pill.classList.remove("visible", "final");
  }
}

updateEpisodeBadge(scanPageEpisodes());

function markActive() {
  button.classList.add("active");
}

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "STREAM_DETECTED") markActive();
});

browser.runtime.sendMessage({ action: "GET_STREAM_STATUS" }).then((response) => {
  if (response && response.hasStream) markActive();
}).catch(() => {});
if (document.querySelector("video")) markActive();

let dragging = false;
let wasDragged = false;
let startX = 0;
let startY = 0;
let initialLeft = 0;
let initialTop = 0;
button.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  wasDragged = false;
  startX = event.clientX;
  startY = event.clientY;
  const rect = host.getBoundingClientRect();
  initialLeft = rect.left;
  initialTop = rect.top;
  event.preventDefault();
});
document.addEventListener("mousemove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragged = true;
  if (!wasDragged) return;
  const left = Math.max(0, Math.min(window.innerWidth - 44, initialLeft + dx));
  const top = Math.max(0, Math.min(window.innerHeight - 44, initialTop + dy));
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  host.style.bottom = "auto";
  host.style.right = "auto";
});
document.addEventListener("mouseup", () => {
  dragging = false;
});
button.addEventListener("click", () => {
  if (wasDragged) {
    wasDragged = false;
    return;
  }
  const currentEpInfo = scanPageEpisodes();
  browser.runtime.sendMessage({
    action: "TRIGGER_VLC",
    nextEpisode: currentEpInfo.nextEpisode,
    currentEpisode: currentEpInfo.currentEpisode,
    totalEpisodes: currentEpInfo.totalEpisodes,
    isLast: Boolean(currentEpInfo.totalEpisodes >= 2 && currentEpInfo.currentEpisode !== null && !currentEpInfo.nextEpisode)
  });
});
(document.documentElement || document.body).appendChild(host);
