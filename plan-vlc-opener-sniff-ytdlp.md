# Firefox VLC Opener: Network Sniffer & yt-dlp Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Firefox VLC Opener with background network media sniffing (webRequest) and local yt-dlp fallback resolution, enabling one-click VLC playback for iframe-embedded streams, hotlink-protected anime CDNs, and supported web players.

**Architecture:** The WebExtension Manifest V3 uses `webRequest` and `<all_urls>` host permissions to monitor HTTP requests. It uses `onBeforeSendHeaders` (with requestHeaders) to correlate and store the exact wire `Referer` per request, and inspects HTTP Range headers and 206 status to ignore fragment chunks. Discovered streams are routed into a dual-slot tracker per tab (`playlist` slot for .m3u8/.mpd, `direct` slot for .mp4/.webm) so chunk flooding never displaces playlists. The native Python helper (`vlc_opener_host.py`) accepts `url`, optional `referer`, and optional `is_direct` flag: direct streams launch VLC immediately with `--http-referrer`, while arbitrary webpages call local `yt-dlp` using single-stream format `-f "b/best"` with a 15-second timeout, strictly validating the extracted URL for http/https before launching VLC in a detached session.

**Tech Stack:** Python 3 (standard library: `subprocess`, `urllib.parse`, `shutil`, `json`, `struct`), `yt-dlp` CLI (installed at `/usr/sbin/yt-dlp`), VLC 3.0, Firefox WebExtensions Manifest V3 (`webRequest`, `action`, `contextMenus`, `scripting`, `notifications`), Node.js (test runner for extension logic).

**Spec:** User request 2026-11-09 combining option 2 (yt-dlp local helper) and option 3 (extension network sniffer) to support streaming sites like Sokuja and other embed/iframe players without manual link extraction.

## Global Constraints

- Working folder (repository root): `/home/lyravein/Documents/Playground/work/vlc-opener`
- All commands in tasks assume working directory is the repository root (`cd /home/lyravein/Documents/Playground/work/vlc-opener`).
- GitHub repository target: `Lyravein/firefox-vlc-opener` (public repository on branch `main`).
- No em-dashes anywhere in source files, commit messages, comments, or documentation.
- Python native host must use standard library only, plus optional detection of external `yt-dlp` binary across PATH and `/usr/sbin/yt-dlp`.
- Subprocess execution must always use list arguments with `--` separator: never `shell=True`.
- VLC referer flag: pass `--http-referrer` followed by the sanitized referer string before `--`.
- Scheme whitelist: only `http` and `https` schemes permitted for both target URL, extracted resolver URL, and referer.
- yt-dlp extraction validation: pass `-f "b/best"` format selector so a single pre-muxed stream URL is returned. The extracted stream URL must be validated for safe http/https scheme and hostname before being passed to `subprocess.Popen`. Non-HTTP schemes (e.g. `file:`) or empty outputs must never reach VLC.
- Dual-slot stream tracker: per-tab state maintains separate slots for `playlist` (.m3u8/.mpd) and `direct` (.mp4/.webm); playlist slot takes strict precedence on click and cannot be evicted by MP4 chunks.
- Sniffer noise reduction: ignore individual HLS/DASH chunk files (`.ts`, `.m4s`, `.aac`, `.vtt`, HTTP `Range` header requests, and HTTP 206 Partial Content responses).
- Request correlation: correlate request headers and response events via `requestId` map with automatic eviction on completed, error, or 60-second timeout.
- Wire Referer capture: read exact header from `details.requestHeaders` on `onBeforeSendHeaders` with `requestHeaders` extraInfoSpec.
- Tab lifecycle cleanup: `tabStreams` entries deleted on `tabs.onRemoved` and `tabs.onUpdated` (when status is loading).

## Review Focus

1. Resolver output security boundary: verify `target_url` extracted from `yt-dlp` is strictly validated as a safe http/https URL before calling `subprocess.Popen`, blocking local path or file scheme execution.
2. Single-stream format selection: verify yt-dlp is invoked with `-f "b/best"` to avoid returning split video-only and audio-only URLs.
3. Playlist retention against chunk flooding: verify dual-slot tracker stores `playlist` and `direct` separately so ongoing MP4 segment downloads cannot evict a discovered HLS playlist.
4. Accurate Referer propagation and request correlation: verify `Referer` header is captured directly from request headers during `onBeforeSendHeaders` and correlated with response MIME type events via `requestId`.
5. Tab and request memory cleanup: verify `tabStreams` entries and `pendingRequests` entries are pruned on tab navigation and request completion.

---

### Task 1: Validator Enhancement for Referer, Direct Hints, and Multi-Mode Resolution

**Files:**
- Modify: `host/validator.py`
- Test: `tests/test_validator.py`

**Interfaces:**
- Consumes: `url: str`, `referer: str | None = None`, `is_direct: bool = False`
- Produces: `validate_request(url: str, referer: str | None = None, is_direct: bool = False) -> tuple[bool, str, str, str | None]` returning `(is_valid, mode, cleaned_url_or_error, cleaned_referer)`
  - `mode`: `"direct"` (ends with allowed media extension or flagged `is_direct=True`) or `"ytdlp"` (arbitrary http/https page URL)

- [ ] **Step 1: Write failing tests for referer validation, direct hint, and multi-mode resolution**

In `tests/test_validator.py`, add imports `from host.validator import validate_request, validate_media_url` and test cases:
```python
def test_valid_direct_media_with_referer(self):
    ok, mode, url, ref = validate_request(
        "https://cdn.example.com/stream.m3u8",
        referer="https://anime.example.com/watch/123"
    )
    self.assertTrue(ok)
    self.assertEqual(mode, "direct")
    self.assertEqual(url, "https://cdn.example.com/stream.m3u8")
    self.assertEqual(ref, "https://anime.example.com/watch/123")

def test_valid_direct_with_is_direct_hint(self):
    ok, mode, url, ref = validate_request(
        "https://cdn.example.com/stream_without_extension?token=abc",
        is_direct=True
    )
    self.assertTrue(ok)
    self.assertEqual(mode, "direct")

def test_valid_page_url_for_ytdlp_mode(self):
    ok, mode, url, ref = validate_request(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        referer=None
    )
    self.assertTrue(ok)
    self.assertEqual(mode, "ytdlp")
    self.assertEqual(url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    self.assertIsNone(ref)

def test_reject_dangerous_referer(self):
    ok, mode, err, ref = validate_request(
        "https://cdn.example.com/stream.mp4",
        referer="javascript:alert(1)"
    )
    self.assertFalse(ok)
    self.assertIn("referer", err.lower())

def test_reject_referer_with_control_chars(self):
    ok, mode, err, ref = validate_request(
        "https://cdn.example.com/stream.mp4",
        referer="https://example.com/\x00evil"
    )
    self.assertFalse(ok)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_validator.py -k "validate_request"`
Expected: FAIL with `ImportError` or `NameError`.

- [ ] **Step 3: Implement `validate_request` in `host/validator.py`**

Preserve backwards-compatible `validate_media_url` and implement `validate_request`:
```python
def validate_request(
    url: str,
    referer: str | None = None,
    is_direct: bool = False
) -> tuple[bool, str, str, str | None]:
    if not isinstance(url, str) or not url or any(c in url for c in "\x00\n\r"):
        return False, "error", "Invalid URL input", None
    cleaned_url = url.strip()
    if not cleaned_url:
        return False, "error", "Invalid URL input", None

    try:
        parsed = urlsplit(cleaned_url)
    except ValueError:
        return False, "error", "Invalid URL", None

    if parsed.scheme.lower() not in ("http", "https"):
        return False, "error", "Unsupported URL scheme", None
    if "@" in parsed.netloc:
        return False, "error", "URL credentials are not allowed", None

    try:
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False, "error", "Invalid URL authority or port", None

    if not hostname:
        return False, "error", "Invalid URL hostname", None
    if port is not None and not 1 <= port <= 65535:
        return False, "error", "Invalid URL port", None

    cleaned_ref = None
    if referer is not None:
        if not isinstance(referer, str) or any(c in referer for c in "\x00\n\r"):
            return False, "error", "Invalid Referer input", None
        r_strip = referer.strip()
        if r_strip:
            try:
                r_parsed = urlsplit(r_strip)
                if r_parsed.scheme.lower() not in ("http", "https") or not r_parsed.hostname:
                    return False, "error", "Unsupported Referer scheme or hostname", None
                cleaned_ref = r_strip
            except Exception:
                return False, "error", "Invalid Referer URL", None

    ext = os.path.splitext(parsed.path)[1].lower()
    if is_direct or ext in _MEDIA_EXTENSIONS:
        return True, "direct", cleaned_url, cleaned_ref

    return True, "ytdlp", cleaned_url, cleaned_ref
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_validator.py`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add host/validator.py tests/test_validator.py
git commit -m "feat(host): add referer validation, direct hint, and multi-mode resolution support"
```

---

### Task 2: VLC Launcher & Host Integration for Referer, yt-dlp Resolution, and Safety Validation

**Files:**
- Modify: `host/vlc_launcher.py`
- Modify: `host/vlc_opener_host.py`
- Test: `tests/test_launcher.py`

**Interfaces:**
- `find_ytdlp_binary(custom_bin: str = "yt-dlp") -> str | None`: searches PATH and `/usr/sbin/yt-dlp`, `/usr/bin/yt-dlp`.
- `launch_vlc(url: str, referer: str | None = None, mode: str = "direct", vlc_bin: str = "vlc", ytdlp_bin: str = "yt-dlp") -> tuple[bool, str]`
  - Validates extracted yt-dlp URL with `validate_request` before invoking VLC!
  - Passes `-f "b/best"` to yt-dlp to guarantee single combined video+audio stream.
- `vlc_opener_host.py`: handles payload `{"url": "...", "referer": "...", "is_direct": false}`.

- [ ] **Step 1: Write failing tests for resolver validation, direct bypass, timeout, and failure recovery**

In `tests/test_launcher.py`, ensure imports include `import subprocess`, `from unittest.mock import patch, MagicMock`, `from host.vlc_launcher import launch_vlc, find_ytdlp_binary`:
```python
@patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
@patch("subprocess.Popen")
def test_launch_vlc_with_referer(self, mock_popen, mock_which):
    mock_proc = MagicMock()
    mock_proc.pid = 8888
    mock_popen.return_value = mock_proc

    ok, msg = launch_vlc("https://cdn.example.com/video.mp4", referer="https://anime.example.com/")
    self.assertTrue(ok)
    args, kwargs = mock_popen.call_args
    cmd = args[0]
    self.assertEqual(cmd, ["/usr/bin/vlc", "--http-referrer", "https://anime.example.com/", "--", "https://cdn.example.com/video.mp4"])

@patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
@patch("subprocess.run")
@patch("subprocess.Popen")
def test_direct_mode_bypasses_ytdlp(self, mock_popen, mock_run, mock_which):
    mock_proc = MagicMock()
    mock_proc.pid = 9999
    mock_popen.return_value = mock_proc

    ok, msg = launch_vlc("https://cdn.example.com/stream.m3u8", mode="direct")
    self.assertTrue(ok)
    mock_run.assert_not_called()

@patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
@patch("subprocess.run")
@patch("subprocess.Popen")
def test_launch_vlc_via_ytdlp_resolver_success(self, mock_popen, mock_run, mock_which):
    mock_ytdlp = MagicMock()
    mock_ytdlp.returncode = 0
    mock_ytdlp.stdout = "https://resolved.cdn.com/stream.m3u8\n"
    mock_run.return_value = mock_ytdlp

    mock_proc = MagicMock()
    mock_proc.pid = 7777
    mock_popen.return_value = mock_proc

    ok, msg = launch_vlc("https://example.com/watch/video", mode="ytdlp")
    self.assertTrue(ok)
    mock_run.assert_called_once()
    run_cmd = mock_run.call_args[0][0]
    self.assertIn("--get-url", run_cmd)
    self.assertIn("-f", run_cmd)
    self.assertIn("b/best", run_cmd)
    vlc_cmd = mock_popen.call_args[0][0]
    self.assertEqual(vlc_cmd, ["/usr/bin/vlc", "--", "https://resolved.cdn.com/stream.m3u8"])

@patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
@patch("subprocess.run")
@patch("subprocess.Popen")
def test_ytdlp_dangerous_output_rejected(self, mock_popen, mock_run, mock_which):
    mock_ytdlp = MagicMock()
    mock_ytdlp.returncode = 0
    mock_ytdlp.stdout = "file:///etc/passwd\n"
    mock_run.return_value = mock_ytdlp

    ok, err = launch_vlc("https://example.com/watch/video", mode="ytdlp")
    self.assertFalse(ok)
    self.assertIn("rejected", err.lower())
    mock_popen.assert_not_called()

@patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
@patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="yt-dlp", timeout=15))
def test_ytdlp_timeout_handled(self, mock_run, mock_which):
    ok, err = launch_vlc("https://example.com/watch/slow", mode="ytdlp")
    self.assertFalse(ok)
    self.assertIn("timed out", err.lower())

@patch("host.vlc_launcher.find_ytdlp_binary", return_value=None)
@patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
def test_ytdlp_missing_handled(self, mock_which, mock_find):
    ok, err = launch_vlc("https://example.com/watch/video", mode="ytdlp")
    self.assertFalse(ok)
    self.assertIn("yt-dlp is required", err)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python3 -m pytest tests/test_launcher.py -k "test_ytdlp_dangerous_output_rejected"`
Expected: FAIL.

- [ ] **Step 3: Update `host/vlc_launcher.py` and `host/vlc_opener_host.py`**

In `host/vlc_launcher.py`:
```python
import os
import shutil
import subprocess
from validator import validate_request

def find_ytdlp_binary(custom_bin: str = "yt-dlp") -> str | None:
    resolved = shutil.which(custom_bin)
    if resolved:
        return resolved
    for candidate in ("/usr/sbin/yt-dlp", "/usr/bin/yt-dlp", "/usr/local/bin/yt-dlp"):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None

def launch_vlc(
    url: str,
    referer: str | None = None,
    mode: str = "direct",
    vlc_bin: str = "vlc",
    ytdlp_bin: str = "yt-dlp",
) -> tuple[bool, str]:
    resolved_vlc = shutil.which(vlc_bin)
    if not resolved_vlc:
        return False, f"VLC binary '{vlc_bin}' not found in PATH."

    target_url = url
    if mode == "ytdlp":
        resolved_ytdlp = find_ytdlp_binary(ytdlp_bin)
        if not resolved_ytdlp:
            return False, "yt-dlp is required to resolve this link but was not found in PATH or standard system paths."

        # Use -f b/best to select single pre-muxed format containing both video and audio
        ytdlp_cmd = [resolved_ytdlp, "-f", "b/best", "--get-url", "--no-warnings"]
        if referer:
            ytdlp_cmd.extend(["--referer", referer])
        ytdlp_cmd.extend(["--", url])

        try:
            res = subprocess.run(
                ytdlp_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15,
                check=False,
            )
            if res.returncode != 0 or not res.stdout.strip():
                err_text = res.stderr.strip() or "no stream URL extracted"
                return False, f"yt-dlp extraction failed: {err_text}"

            extracted = res.stdout.strip().splitlines()[0].strip()
            # Security boundary: re-validate extracted URL before passing to VLC
            is_valid, _, clean_extracted, _ = validate_request(extracted, is_direct=True)
            if not is_valid:
                return False, f"Extracted stream URL rejected by security policy: {clean_extracted}"
            target_url = clean_extracted
        except subprocess.TimeoutExpired:
            return False, "yt-dlp resolution timed out after 15 seconds."
        except Exception as e:
            return False, f"yt-dlp execution error: {e}"

    vlc_cmd = [resolved_vlc]
    if referer:
        vlc_cmd.extend(["--http-referrer", referer])
    vlc_cmd.extend(["--", target_url])

    try:
        proc = subprocess.Popen(
            vlc_cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True, f"VLC started (pid: {proc.pid})"
    except Exception as e:
        return False, f"Failed to execute VLC: {e}"
```

In `host/vlc_opener_host.py`:
Read `url`, optional `referer`, and optional `is_direct` from message. Call `validate_request(url, referer, is_direct)`, pass validated values to `launch_vlc`.

- [ ] **Step 4: Run unit tests**

Run: `python3 -m pytest tests/`
Expected: 18+ tests PASS.

- [ ] **Step 5: Commit**

```bash
git add host/vlc_launcher.py host/vlc_opener_host.py tests/test_launcher.py
git commit -m "feat(host): add referer propagation, yt-dlp resolution, and security validation of extracted streams"
```

---

### Task 3: Extension Permissions Update for Network Sniffing

**Files:**
- Modify: `extension/manifest.json`

**Interfaces:**
- Adds `"webRequest"` to `permissions`
- Adds `"host_permissions": ["<all_urls>"]`

- [ ] **Step 1: Update `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Open in VLC",
  "version": "1.1.0",
  "description": "Open direct non-DRM media streams (.mp4, .m3u8, .mpd) or web videos in VLC.",
  "browser_specific_settings": {
    "gecko": {
      "id": "vlc-opener@lyravein.my.id",
      "strict_min_version": "109.0"
    }
  },
  "permissions": [
    "nativeMessaging",
    "contextMenus",
    "activeTab",
    "scripting",
    "notifications",
    "webRequest"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "scripts": ["stream_tracker.js", "background.js"]
  },
  "action": {
    "default_title": "Open Video in VLC",
    "default_icon": {
      "48": "icons/icon-48.png",
      "96": "icons/icon-96.png"
    }
  },
  "icons": {
    "48": "icons/icon-48.png",
    "96": "icons/icon-96.png"
  }
}
```

- [ ] **Step 2: Validate manifest syntax and permissions via python**

Run: `python3 -c "import json; m=json.load(open('extension/manifest.json')); assert 'webRequest' in m['permissions']; assert '<all_urls>' in m['host_permissions']; print('Manifest valid')"`
Expected: `Manifest valid`

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json
git commit -m "feat(extension): add webRequest and host_permissions for media sniffing"
```

---

### Task 4: Extension Background Script: Dual-Slot Tracker, Wire Referer & Unit Tests

**Files:**
- Create: `extension/stream_tracker.js`
- Modify: `extension/background.js`
- Create: `tests/test_stream_tracker.js`

**Interfaces:**
- `stream_tracker.js`:
  - `createStreamTracker()`: maintains per-tab dual-slot state `{ playlist: null, direct: null }` and `pendingRequests` Map.
  - `trackRequest(requestId, tabId, url, headers)`: inspects headers for `referer` and `range`.
  - `recordResponse(requestId, tabId, url, statusCode, responseHeaders)`: checks MIME type and 206 status, maps to `playlist` or `direct` slot.
  - `getBestStream(tabId)`: returns `playlist` slot if present, otherwise `direct` slot.
  - `cleanupRequest(requestId)`: clears pending request entry.
  - `cleanupTab(tabId)`: removes tab entries and associated pending requests.
- `background.js`:
  - Loads `stream_tracker.js`.
  - Subscribes to `browser.webRequest.onBeforeSendHeaders` (with `requestHeaders`) to capture exact wire `Referer` and Range headers.
  - Subscribes to `browser.webRequest.onHeadersReceived` (with `responseHeaders`) to correlate response MIME types.
  - Subscribes to `onCompleted` and `onErrorOccurred` for request cleanup.
  - On action click: checks `getBestStream(tab.id)`. If found, calls `sendUrlToVlc(stream.url, stream.referer, true)`.
  - If not found: probes DOM `<video>`, then falls back to `tab.url` with `is_direct=false` for yt-dlp resolution.

- [ ] **Step 1: Write unit tests in `tests/test_stream_tracker.js`**

```javascript
const assert = require("assert");
const { createStreamTracker } = require("../extension/stream_tracker.js");

const tracker = createStreamTracker();

// 1. Chunks with range headers or chunk extensions are ignored
tracker.trackRequest("req1", 1, "https://cdn.com/seg1.ts", [{ name: "Referer", value: "https://page.com" }]);
assert.strictEqual(tracker.recordResponse("req1", 1, "https://cdn.com/seg1.ts", 200, [{ name: "Content-Type", value: "video/mp2t" }]), false);

tracker.trackRequest("req2", 1, "https://cdn.com/video.mp4", [{ name: "Range", value: "bytes=0-100" }]);
assert.strictEqual(tracker.recordResponse("req2", 1, "https://cdn.com/video.mp4", 206, [{ name: "Content-Type", value: "video/mp4" }]), false);

// 2. Direct MP4 recorded with wire referer
tracker.trackRequest("req3", 1, "https://cdn.com/video.mp4", [{ name: "Referer", value: "https://wire-referer.com" }]);
assert.strictEqual(tracker.recordResponse("req3", 1, "https://cdn.com/video.mp4", 200, [{ name: "Content-Type", value: "video/mp4" }]), true);
assert.strictEqual(tracker.getBestStream(1).url, "https://cdn.com/video.mp4");
assert.strictEqual(tracker.getBestStream(1).referer, "https://wire-referer.com");

// 3. Playlist recorded and strictly prioritized over MP4
tracker.trackRequest("req4", 1, "https://cdn.com/master.m3u8", [{ name: "Referer", value: "https://wire-referer.com" }]);
assert.strictEqual(tracker.recordResponse("req4", 1, "https://cdn.com/master.m3u8", 200, [{ name: "Content-Type", value: "application/vnd.apple.mpegurl" }]), true);
assert.strictEqual(tracker.getBestStream(1).url, "https://cdn.com/master.m3u8");

// 4. Later MP4 chunks NEVER evict discovered playlist
for (let i = 0; i < 10; i++) {
  tracker.trackRequest(`req_mp4_${i}`, 1, `https://cdn.com/segment_${i}.mp4`, []);
  tracker.recordResponse(`req_mp4_${i}`, 1, `https://cdn.com/segment_${i}.mp4`, 200, [{ name: "Content-Type", value: "video/mp4" }]);
}
assert.strictEqual(tracker.getBestStream(1).url, "https://cdn.com/master.m3u8");

// 5. Tab cleanup
tracker.cleanupTab(1);
assert.strictEqual(tracker.getBestStream(1), null);

console.log("Stream tracker unit tests PASSED.");
```

- [ ] **Step 2: Implement `extension/stream_tracker.js`**

```javascript
// extension/stream_tracker.js

function createStreamTracker() {
  const tabs = new Map();
  const pendingRequests = new Map();

  function isIgnoredUrl(url) {
    if (!url) return true;
    return /\.(ts|m4s|aac|vtt)(\?.*)?$/i.test(url) || /[\?&]range=/i.test(url) || /[\?&]segment=/i.test(url);
  }

  function getStreamType(url, contentType = "") {
    const ctl = contentType.toLowerCase();
    if (/\.(m3u8|mpd)(\?.*)?$/i.test(url) || ctl.includes("mpegurl") || ctl.includes("dash+xml")) {
      return "playlist";
    }
    if (/\.(mp4|webm|mkv|mov)(\?.*)?$/i.test(url) || ctl.startsWith("video/")) {
      return "direct";
    }
    return null;
  }

  function trackRequest(requestId, tabId, url, requestHeaders = []) {
    if (!requestId || tabId < 0 || isIgnoredUrl(url)) return;

    let referer = "";
    let hasRange = false;
    for (const h of requestHeaders) {
      const name = h.name.toLowerCase();
      if (name === "referer") referer = h.value || "";
      if (name === "range") hasRange = true;
    }

    pendingRequests.set(requestId, {
      tabId,
      url,
      referer,
      hasRange,
      timestamp: Date.now()
    });

    // Auto-clean stale pending requests after 60s
    setTimeout(() => {
      pendingRequests.delete(requestId);
    }, 60000);
  }

  function recordResponse(requestId, tabId, url, statusCode, responseHeaders = []) {
    const pending = pendingRequests.get(requestId);
    const referer = pending ? pending.referer : "";
    const hasRange = pending ? pending.hasRange : false;
    pendingRequests.delete(requestId);

    if (statusCode === 206 || hasRange || isIgnoredUrl(url)) {
      return false;
    }

    let contentType = "";
    for (const h of responseHeaders) {
      if (h.name.toLowerCase() === "content-type") {
        contentType = h.value || "";
        break;
      }
    }

    const type = getStreamType(url, contentType);
    if (!type) return false;

    let entry = tabs.get(tabId);
    if (!entry) {
      entry = { playlist: null, direct: null };
      tabs.set(tabId, entry);
    }

    const record = { url, referer, type, timestamp: Date.now() };
    if (type === "playlist") {
      entry.playlist = record;
    } else {
      entry.direct = record;
    }
    return true;
  }

  function getBestStream(tabId) {
    const entry = tabs.get(tabId);
    if (!entry) return null;
    return entry.playlist || entry.direct;
  }

  function cleanupRequest(requestId) {
    pendingRequests.delete(requestId);
  }

  function cleanupTab(tabId) {
    tabs.delete(tabId);
    for (const [reqId, data] of pendingRequests.entries()) {
      if (data.tabId === tabId) pendingRequests.delete(reqId);
    }
  }

  return { trackRequest, recordResponse, getBestStream, cleanupRequest, cleanupTab, isIgnoredUrl };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createStreamTracker };
}
```

- [ ] **Step 3: Run Node.js unit test**

Run: `node tests/test_stream_tracker.js`
Expected: `Stream tracker unit tests PASSED.`

- [ ] **Step 4: Update `extension/manifest.json` scripts and `extension/background.js`**

In `extension/manifest.json`:
```json
"background": {
  "scripts": ["stream_tracker.js", "background.js"]
}
```

In `extension/background.js`:
- Wire `browser.webRequest.onBeforeSendHeaders.addListener` with `["requestHeaders"]` to call `tracker.trackRequest`.
- Wire `browser.webRequest.onHeadersReceived.addListener` with `["responseHeaders"]` to call `tracker.recordResponse`.
- Wire `onCompleted` and `onErrorOccurred` to call `tracker.cleanupRequest`.
- Wire tab cleanup on `tabs.onRemoved` and `tabs.onUpdated`.
- Wire toolbar action to retrieve `getBestStream` and pass `{ url, referer, is_direct: true }`.
- Lint with `node -c extension/stream_tracker.js && node -c extension/background.js`.

- [ ] **Step 5: Commit**

```bash
git add extension/stream_tracker.js extension/background.js extension/manifest.json tests/test_stream_tracker.js
git commit -m "feat(extension): implement request-correlated stream tracker, wire referer extraction, and automated unit tests"
```

---

### Task 5: Integration Pipeline Test & Documentation Update

**Files:**
- Modify: `test_cli_pipe.sh`
- Modify: `README.md`

**Interfaces:**
- `test_cli_pipe.sh` verifies:
  1. Direct media URL launches VLC with `--http-referrer`
  2. yt-dlp mode triggers when given a page URL, passes `-f "b/best"`, and validates extracted URL
  3. Rejection of dangerous resolver output (e.g. `file://`)
- `README.md` documents sniffer badge, dual-slot queue, referer forwarding, and yt-dlp resolution.

- [ ] **Step 1: Add mock yt-dlp, referer checks, and security re-validation to `test_cli_pipe.sh`**

Add mock `yt-dlp` executable in `$tmp_dir/bin/yt-dlp`.
Verify pipe with `{"url": "https://example.com/page", "referer": "https://example.com/"}`.
Verify dangerous output rejection.

- [ ] **Step 2: Run all test suites**

Run: `python3 -m pytest tests/ && node tests/test_stream_tracker.js && bash test_cli_pipe.sh`
Expected: All tests pass cleanly.

- [ ] **Step 3: Update `README.md`**

Update documentation with sniffer details, yt-dlp fallback, and usage tips.

- [ ] **Step 4: Commit**

```bash
git add test_cli_pipe.sh README.md
git commit -m "test: add yt-dlp resolver and referer pipeline tests and update documentation"
```

---

### Task 6: GitHub Publication & Release Push

**Files:**
- Git repository `work/vlc-opener`

- [ ] **Step 1: Push all commits to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Verify git status and remote state**

Run: `git status && git log -n 5 --oneline`
Expected: Clean working tree, remote up to date.

---

## Risks, Tradeoffs, and Open Questions

1. **Host-permissions warning on extension installation:**
   - Adding `<all_urls>` causes Firefox to display a permission warning ("Access your data for all websites"). This is unavoidable for network sniffing across arbitrary third-party streaming embeds and iframes.
2. **Segment duplication in HLS streams:**
   - Solved completely by dual-slot per-tab tracker (`playlist` slot and `direct` slot); playlists are never evicted by segments, and HTTP Range/206 requests are filtered out.
3. **DRM (Widevine / EME):**
   - Sites using Widevine DRM (Netflix, Crunchyroll, etc.) will still fail in VLC because the decrypted keys cannot be extracted. The sniffer will catch the stream manifest, but VLC will fail to decrypt. This is noted in the documentation.
