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
  button { position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 2px solid #e66014; border-radius: 50%; background: #1a1e28; color: white; cursor: pointer; transition: transform 120ms ease, border-color 120ms ease; }
  button:hover { transform: scale(1.08); border-color: #ff812e; }
  button.active { border-color: #22c55e; box-shadow: 0 0 12px #22c55e99; }
  .badge { display: none; position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; }
  button.active .badge { display: block; animation: pulse 1.4s infinite; }
  @keyframes pulse { 50% { opacity: .45; transform: scale(.8); } }
`;
const button = document.createElement("button");
button.type = "button";
button.title = "Open in VLC (Drag to move)";
button.setAttribute("aria-label", "Open in VLC");
button.innerHTML = '<svg width="25" height="30" viewBox="0 0 24 30" aria-hidden="true"><path fill="#fff" d="M4 2h16l-2 5H6z"/><path fill="#e66014" d="M6 8h12l-2 5H8z"/><path fill="#fff" d="M8 14h8l-2 5h-4z"/><path fill="#e66014" d="M10 20h4l-2 7z"/></svg><span class="badge"></span>';
shadow.append(style, button);

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
  browser.runtime.sendMessage({ action: "TRIGGER_VLC" });
});
(document.documentElement || document.body).appendChild(host);
