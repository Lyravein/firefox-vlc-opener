(function () {
  if (window.__vlc_opener_injected) return;
  window.__vlc_opener_injected = true;

  if (window.self !== window.top && (window.innerWidth < 150 || window.innerHeight < 150)) {
    return;
  }

  const host = document.createElement("div");
  host.id = "vlc-opener-floating-root";
  host.style.cssText = "all: initial; position: fixed !important; bottom: 24px !important; right: 24px !important; z-index: 2147483647 !important; pointer-events: auto !important;";
  const shadow = host.attachShadow({ mode: "open" });

  const targetRoot = document.body || document.documentElement;
  if (targetRoot) targetRoot.appendChild(host);
  else document.addEventListener("DOMContentLoaded", () => (document.body || document.documentElement).appendChild(host));

  const style = document.createElement("style");
  style.textContent = `
    :host { position: fixed !important; bottom: 24px !important; right: 24px !important; z-index: 2147483647 !important; pointer-events: auto !important; }
    .vlc-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 14px;
      border: 2px solid #e66014;
      border-radius: 999px;
      background: #151922;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      user-select: none;
    }
    .vlc-pill:hover {
      transform: scale(1.05);
      border-color: #ff8533;
      box-shadow: 0 6px 22px rgba(230, 96, 20, 0.35);
    }
    .vlc-pill.active {
      border-color: #22c55e;
      box-shadow: 0 0 14px rgba(34, 197, 94, 0.45);
    }
    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #e66014;
      transition: background 150ms ease;
    }
    .vlc-pill.active .dot {
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
      animation: pulse 1.4s infinite;
    }
    @keyframes pulse { 50% { opacity: 0.4; transform: scale(0.8); } }
    .label {
      line-height: 1;
      white-space: nowrap;
    }
  `;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "vlc-pill";
  button.title = "Open in VLC (Drag to move)";
  button.setAttribute("aria-label", "Open in VLC");
  button.innerHTML = '<svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path fill="#ffffff" d="M3 1h12l-1.5 3.5h-9z"/><path fill="#e66014" d="M4.5 4.5h9L12 8H6z"/><path fill="#ffffff" d="M6 8h6l-1.5 3.5h-3z"/><path fill="#e66014" d="M7.5 11.5h3L9 21z"/></svg><span class="label">Open in VLC</span><span class="dot"></span>';

  const label = button.querySelector(".label");
  shadow.append(style, button);

  function scanPageEpisodes() {
    try {
      if (typeof parseEpisodes !== "function") return { episodes: [], currentEpisode: null, totalEpisodes: 0, nextEpisode: null };
      return parseEpisodes({
        url: window.location.href,
        title: document.title,
        links: Array.from(document.querySelectorAll("a[href]")).map((a) => ({ href: a.href, text: a.textContent || "", className: a.className || "" })),
        options: Array.from(document.querySelectorAll("select option")).map((o) => ({ value: o.value || "", text: o.textContent || "", selected: Boolean(o.selected) })),
      });
    } catch {
      return { episodes: [], currentEpisode: null, totalEpisodes: 0, nextEpisode: null };
    }
  }

  function updateLabel(info) {
    if (info.totalEpisodes >= 2) {
      const text = `Ep ${info.currentEpisode || "?"} / ${info.totalEpisodes}`;
      label.textContent = `${text} \u00b7 Open in VLC`;
      button.title = `Episode ${info.currentEpisode || "?"} of ${info.totalEpisodes} (Drag to move)`;
    } else {
      label.textContent = "Open in VLC";
      button.title = "Open in VLC (Drag to move)";
    }
  }

  updateLabel(scanPageEpisodes());

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
    if (!wasDragged && Math.hypot(dx, dy) <= 4) return;
    wasDragged = true;
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
      isLast: Boolean(currentEpInfo.totalEpisodes >= 2 && currentEpInfo.currentEpisode !== null && !currentEpInfo.nextEpisode),
    });
  });
})();
