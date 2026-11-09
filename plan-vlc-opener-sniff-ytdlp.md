# Firefox VLC Opener: Network Sniffer & yt-dlp Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Firefox VLC Opener with background network media sniffing (webRequest) and local yt-dlp fallback resolution, enabling one-click VLC playback for iframe-embedded streams, hotlink-protected anime CDNs, and supported web players.

**Architecture:** The WebExtension Manifest V3 uses `webRequest` and `<all_urls>` host permissions to passively monitor HTTP requests for master playlists (.m3u8, .mpd) and direct video streams (.mp4, .webm) across parent pages and nested cross-origin iframes, capturing the URL and origin `Referer` while setting a toolbar badge. The native Python helper (`vlc_opener_host.py`) accepts both `url` and optional `referer`: if the URL is direct media, it launches VLC immediately with `--http-referrer`; if the URL is an arbitrary webpage or embed, it calls local `yt-dlp` to extract the underlying stream URL before launching VLC in a detached session.

**Tech Stack:** Python 3 (standard library: `subprocess`, `urllib.parse`, `shutil`, `json`, `struct`), `yt-dlp` CLI (installed at `/usr/sbin/yt-dlp`), VLC 3.0, Firefox WebExtensions Manifest V3 (`webRequest`, `action`, `contextMenus`, `scripting`, `notifications`).

**Spec:** User request 2026-11-09 combining option 2 (yt-dlp local helper) and option 3 (extension network sniffer) to support streaming sites like Sokuja and other embed/iframe players without manual link extraction.

## Global Constraints

- Working folder (repository root): `/home/lyravein/Documents/Playground/work/vlc-opener`
- All commands in tasks assume working directory is the repository root (`cd /home/lyravein/Documents/Playground/work/vlc-opener`).
- GitHub repository target: `Lyravein/firefox-vlc-opener` (public repository on branch `main`).
- No em-dashes anywhere in source files, commit messages, comments, or documentation.
- Python native host must use standard library only, plus optional detection of external `yt-dlp` binary.
- Subprocess execution must always use list arguments with `--` separator: never `shell=True`.
- VLC referer flag: pass `--http-referrer` followed by the sanitized referer string before `--`.
- Scheme whitelist: only `http` and `https` schemes permitted for both target URL and referer.
- yt-dlp execution safety: bounded timeout (15 seconds), list arguments `["yt-dlp", "--get-url", "--no-warnings", ...]`, `--` separator.
- Sniffer noise reduction: ignore individual HLS transport stream chunks (`.ts`, `.m4s`) so memory is not flooded and master/media playlists (`.m3u8`) remain prioritized.
- Tab lifecycle cleanup: `capturedStreams` entries must be deleted on `tabs.onRemoved` and `tabs.onUpdated` (when status is loading).

## Review Focus

1. Hotlink / CDN 403 Forbidden prevention: verify `Referer` header is correctly captured from `details.originUrl` / `details.documentUrl` and forwarded to VLC via `--http-referrer`.
2. Segment chunk flooding: verify HLS/DASH chunk files (`.ts`, `.m4s`, `.mp4` segment byte-ranges) do not overwrite or push out top-level playlist (`.m3u8`) URLs in the sniffer.
3. yt-dlp hanging or failure recovery: verify `subprocess.run` has a strict timeout (15s) and handles `CalledProcessError` or empty output gracefully with a descriptive notification.
4. Direct stream performance: verify direct media URLs (.mp4, .m3u8) continue to launch VLC directly without invoking `yt-dlp`, keeping latency minimal.
5. Inactive tab leak: verify `Map` in `background.js` does not leak memory when users open and close multiple streaming tabs.

---

### Task 1: Validator Enhancement for Referer and Multi-Mode Resolution

**Files:**
- Modify: `host/validator.py`
- Test: `tests/test_validator.py`

**Interfaces:**
- Consumes: `url: str`, `referer: str | None = None`
- Produces: `validate_request(url: str, referer: str | None = None) -> tuple[bool, str, str | None, str]` returning `(is_valid, mode, cleaned_url_or_error, cleaned_referer)`
  - `mode`: `"direct"` (ends with allowed media extension) or `"ytdlp"` (arbitrary http/https page URL)

- [ ] **Step 1: Write failing tests for referer validation and multi-mode resolution**

Add to `tests/test_validator.py`:
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

Run: `pytest tests/test_validator.py -k "validate_request"`
Expected: FAIL with `NameError: name 'validate_request' is not defined`

- [ ] **Step 3: Implement `validate_request` in `host/validator.py`**

Preserve backwards-compatible `validate_media_url` and add `validate_request`:
```python
def validate_request(url: str, referer: str | None = None) -> tuple[bool, str, str, str | None]:
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
    if ext in _MEDIA_EXTENSIONS:
        return True, "direct", cleaned_url, cleaned_ref

    return True, "ytdlp", cleaned_url, cleaned_ref
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_validator.py`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add host/validator.py tests/test_validator.py
git commit -m "feat(host): add referer validation and multi-mode resolution support"
```

---

### Task 2: VLC Launcher & Host Integration for Referer and yt-dlp Resolution

**Files:**
- Modify: `host/vlc_launcher.py`
- Modify: `host/vlc_opener_host.py`
- Test: `tests/test_launcher.py`

**Interfaces:**
- `launch_vlc(url: str, referer: str | None = None, mode: str = "direct", vlc_bin: str = "vlc", ytdlp_bin: str = "yt-dlp") -> tuple[bool, str]`
- `vlc_opener_host.py`: handles payload `{"url": "...", "referer": "..."}` and returns `{success, message, url, mode}`.

- [ ] **Step 1: Write failing tests for referer passing and yt-dlp resolution**

Add to `tests/test_launcher.py`:
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
def test_launch_vlc_via_ytdlp_resolver(self, mock_popen, mock_run, mock_which):
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
    self.assertIn("--get-url", mock_run.call_args[0][0])
    vlc_cmd = mock_popen.call_args[0][0]
    self.assertEqual(vlc_cmd, ["/usr/bin/vlc", "--", "https://resolved.cdn.com/stream.m3u8"])
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pytest tests/test_launcher.py -k "test_launch_vlc_with_referer"`
Expected: FAIL (argument mismatch or unexpected argument).

- [ ] **Step 3: Update `host/vlc_launcher.py` and `host/vlc_opener_host.py`**

In `host/vlc_launcher.py`:
```python
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
        resolved_ytdlp = shutil.which(ytdlp_bin)
        if not resolved_ytdlp:
            return False, f"yt-dlp is required to resolve this link but was not found in PATH."

        ytdlp_cmd = [resolved_ytdlp, "--get-url", "--no-warnings"]
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
                check=False
            )
            if res.returncode != 0 or not res.stdout.strip():
                err_text = res.stderr.strip() or "no stream URL extracted"
                return False, f"yt-dlp extraction failed: {err_text}"
            target_url = res.stdout.strip().splitlines()[0]
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
Connect `validate_request` and pass `referer` and `mode` to `launch_vlc`.

- [ ] **Step 4: Run unit tests**

Run: `pytest tests/`
Expected: 15+ tests PASS.

- [ ] **Step 5: Commit**

```bash
git add host/vlc_launcher.py host/vlc_opener_host.py tests/test_launcher.py
git commit -m "feat(host): add referer propagation and yt-dlp resolution fallback"
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
    "scripts": ["background.js"]
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

### Task 4: Extension Background Script: Passive Network Sniffing & Stream Queue

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Listens to `webRequest.onBeforeRequest` and `webRequest.onHeadersReceived`
- Maintains `capturedStreams = new Map<tabId, Array<{url, referer, type, timestamp}>>`
- Filters out chunk extensions (`.ts`, `.m4s`, `.aac`) to prioritize playlists and master streams
- Updates badge text: `browser.action.setBadgeText({ tabId, text: "▶" })`
- `sendUrlToVlc(url, referer)` sends `{ url, referer }` to native host

- [ ] **Step 1: Implement stream capture listeners and tab lifecycle cleanup**

In `extension/background.js`:
1. Media regexes:
   - Playlist/Master (high priority): `/\.(m3u8|mpd)(\?.*)?$/i`
   - Direct Media (medium priority): `/\.(mp4|webm|mkv|mov)(\?.*)?$/i`
   - Ignored chunks: `/\.(ts|m4s|aac|vtt)(\?.*)?$/i`
2. Listener:
   ```javascript
   browser.webRequest.onBeforeRequest.addListener(
     (details) => {
       if (details.tabId < 0) return;
       const url = details.url;
       if (isIgnoredChunk(url)) return;

       if (isMediaUrl(url)) {
         const referer = details.originUrl || details.documentUrl || "";
         recordCapturedStream(details.tabId, url, referer);
       }
     },
     { urls: ["<all_urls>"] }
   );
   ```
3. Response headers check:
   ```javascript
   browser.webRequest.onHeadersReceived.addListener(
     (details) => {
       if (details.tabId < 0) return;
       const ct = details.responseHeaders?.find(h => h.name.toLowerCase() === "content-type")?.value?.toLowerCase() || "";
       if (ct.includes("application/vnd.apple.mpegurl") || ct.includes("application/x-mpegurl") || ct.includes("application/dash+xml") || ct.startsWith("video/")) {
         if (!isIgnoredChunk(details.url)) {
           const referer = details.originUrl || details.documentUrl || "";
           recordCapturedStream(details.tabId, details.url, referer);
         }
       }
     },
     { urls: ["<all_urls>"] },
     ["responseHeaders"]
   );
   ```
4. Tab cleanup:
   ```javascript
   browser.tabs.onRemoved.addListener(tabId => capturedStreams.delete(tabId));
   browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
     if (changeInfo.status === "loading") {
       capturedStreams.delete(tabId);
       browser.action.setBadgeText({ tabId, text: "" });
     }
   });
   ```
5. Action click priority:
   - If tab has captured streams: pick newest master playlist (.m3u8/.mpd) or newest direct stream, call `sendUrlToVlc(stream.url, stream.referer)`.
   - Else: try DOM `<video>` inspection.
   - Else: fallback to sending current `tab.url` with referer for yt-dlp resolution.
6. Context menu click:
   - Pass candidate URL with `referer: tab.url` to `sendUrlToVlc(candidate, tab.url)`.

- [ ] **Step 2: Syntax and lint check**

Run: `node -c extension/background.js`
Expected: Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): implement network media sniffing, badge alerts, and referer forwarding"
```

---

### Task 5: Integration Pipeline Test & Documentation Update

**Files:**
- Modify: `test_cli_pipe.sh`
- Modify: `README.md`

**Interfaces:**
- `test_cli_pipe.sh` verifies:
  1. Direct media URL launches VLC with `--http-referrer`
  2. yt-dlp mode triggers when given a page URL
  3. Symlinked execution passes referer
- `README.md` documents:
  1. Network sniffer behavior and badge indicator
  2. yt-dlp prerequisites and resolution capability
  3. Streaming site usage (e.g. anime and embed players)

- [ ] **Step 1: Add mock yt-dlp and referer checks to `test_cli_pipe.sh`**

Add mock `yt-dlp` executable in `$tmp_dir/bin/yt-dlp` returning `https://resolved.example.com/playlist.m3u8`.
Test pipe payload `{"url": "https://example.com/page", "referer": "https://example.com/"}`.
Verify response `success == True`.

- [ ] **Step 2: Run test suite and integration script**

Run: `pytest tests/ && bash test_cli_pipe.sh`
Expected: All tests pass cleanly.

- [ ] **Step 3: Update `README.md`**

Add clear explanations of the network sniffer badge (`▶`), how iframe videos are automatically captured, and how yt-dlp extracts streams.

- [ ] **Step 4: Commit**

```bash
git add test_cli_pipe.sh README.md
git commit -m "test: add yt-dlp and referer pipeline tests and update documentation"
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
   - Some players issue hundreds of `.ts` chunk requests. Filtering these out via regex keeps memory usage negligible.
3. **DRM (Widevine / EME):**
   - Sites using Widevine DRM (Netflix, Crunchyroll, etc.) will still fail in VLC because the decrypted keys cannot be extracted. The sniffer will catch the stream manifest, but VLC will fail to decrypt. This is noted in the documentation.
