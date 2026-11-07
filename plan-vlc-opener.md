# Firefox Direct Media Opener (VLC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, lightweight Firefox WebExtension and Linux Native Messaging helper that sends direct non-DRM media URLs (.mp4, .m3u8, .mpd, .webm) to local VLC via context menu and active video button, published to a new GitHub repository under `Lyravein/firefox-vlc-opener`.

**Architecture:** A native Python 3 stdio helper (`host/vlc_opener_host.py`) handles bounded protocol framing, strict media-path URL validation, and detaches the VLC process using `subprocess.Popen` with safe argument boundaries. A Manifest V3 Firefox extension registers context menus for direct links and video elements, plus a toolbar action that probes the active tab's `<video>` DOM for clean direct media URLs while explicitly rejecting blob and DRM EME streams, communicating with the helper via `browser.runtime.sendNativeMessage`. The project is tracked in Git and published to GitHub via `gh repo create`.

**Tech Stack:** Python 3 (standard library only: `struct`, `json`, `sys`, `subprocess`, `urllib.parse`, `shutil`), Firefox WebExtensions API (Manifest V3, `nativeMessaging`, `contextMenus`, `activeTab`, `scripting`, `notifications`), Linux Desktop (`/usr/sbin/vlc`), Git and GitHub CLI (`gh`).

**Spec:** User prompt in conversation 2026-11-07. Scope strictly limited to non-DRM direct URLs (.mp4, .m3u8, .mpd, etc.). No site player scraping, no cookie theft, no DRM circumvention. Includes creating a new GitHub repo.

## Global Constraints

- Working folder (repository root): `/home/lyravein/Documents/Playground/work/vlc-opener`
- All commands in tasks assume working directory is the repository root (`cd /home/lyravein/Documents/Playground/work/vlc-opener`).
- GitHub repo target: `Lyravein/firefox-vlc-opener` (public repository).
- No em-dashes anywhere in source files, commit messages, comments, or documentation.
- Python native host must use standard library only (no external pip dependencies).
- Process execution must pass argv as a list with `--` separator: `[resolved_bin, "--", url]` (never `shell=True`).
- Scheme whitelist: only `http` and `https` schemes permitted.
- Media check: URL path must strictly end with an allowed media extension (.mp4, .m3u8, .mpd, .webm, etc.). Query parameters never bypass this check.
- Native host bounded reading: max message length 1MB, catch JSON/UTF-8 decode errors, require dictionary payload.
- In-page video detection: inspect for `blob:`, `data:`, and `mediaKeys` (DRM EME) to reject encrypted/managed streams gracefully.
- Host executable installed or symlinked to `~/.local/bin/vlc-opener-host`.
- Native messaging manifest registered in `~/.mozilla/native-messaging-hosts/vlc_opener.json`.
- Extension ID fixed: `vlc-opener@lyravein.my.id`.

## Review Focus

1. Command line option injection via malicious URL (e.g. `https://example.com/--extraintf=...`): blocked by URL validation and `--` argument terminator.
2. Dangerous URI schemes (e.g. `file:///etc/passwd`, `javascript:...`, `data:...`): rejected by strict scheme check.
3. Query parameter validation bypass (e.g. `https://example.com/page?param=mp4`): rejected by requiring the pathname itself to terminate in an allowed media extension.
4. Process lifetime decoupling: VLC must survive host process termination via `start_new_session=True`.
5. Non-direct / MSE / blob / DRM EME streams in `<video>` tags: detected via `mediaKeys` and URL scheme, rejected gracefully with user notification.

---

### Task 0: Git Repository Setup & GitHub Remote Creation

**Files:**
- Create: `.gitignore`
- Create: `.git` (via `git init`)

**Interfaces:**
- Produces: Initialized local git repository in `/home/lyravein/Documents/Playground/work/vlc-opener` connected to remote `origin` at `Lyravein/firefox-vlc-opener`.

- [ ] **Step 1: Verify repository root directory**

```bash
cd /home/lyravein/Documents/Playground/work/vlc-opener
pwd
```
Expected: `/home/lyravein/Documents/Playground/work/vlc-opener`

- [ ] **Step 2: Create `.gitignore`**

```gitignore
# .gitignore
__pycache__/
*.py[cod]
*$py.class
.pytest_cache/
.oc/
*.log
.DS_Store
```

- [ ] **Step 3: Initial commit**

```bash
git add .gitignore
git commit -m "chore: initial repository structure"
```

- [ ] **Step 4: Create GitHub repository via `gh` CLI with explicit owner**

```bash
gh repo create Lyravein/firefox-vlc-opener --public --source=. --remote=origin --description "Firefox extension and Linux native messaging helper to open direct media streams (.mp4, .m3u8, .mpd) in VLC"
```

- [ ] **Step 5: Verify remote connection**

Run: `git remote -v && gh repo view Lyravein/firefox-vlc-opener --json name,visibility,url`
Expected: Output showing `origin` URL pointing to `Lyravein/firefox-vlc-opener` and visibility `PUBLIC`.

---

### Task 1: Native Host URL Validator and Security Filter

**Files:**
- Create: `host/validator.py`
- Test: `host/tests/test_validator.py`

**Interfaces:**
- Consumes: URL string
- Produces: `validate_media_url(url: str) -> tuple[bool, str]` returning `(is_valid, error_message_or_cleaned_url)`

- [ ] **Step 1: Write the failing test including query bypass regression**

```python
# host/tests/test_validator.py
import unittest
from host.validator import validate_media_url

class TestMediaUrlValidator(unittest.TestCase):
    def test_valid_http_media_urls(self):
        valid_urls = [
            "https://cdn.example.com/video.mp4",
            "http://example.org/stream/index.m3u8",
            "https://streams.site.net/manifest.mpd?token=abc123",
            "https://media.org/clip.webm#t=10",
        ]
        for url in valid_urls:
            ok, res = validate_media_url(url)
            self.assertTrue(ok, f"Expected valid: {url}, got error: {res}")
            self.assertEqual(res, url)

    def test_reject_dangerous_schemes(self):
        dangerous_urls = [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:video/mp4;base64,AAAA",
            "ftp://ftp.example.com/video.mp4",
        ]
        for url in dangerous_urls:
            ok, err = validate_media_url(url)
            self.assertFalse(ok, f"Expected rejection for: {url}")
            self.assertIn("scheme", err.lower())

    def test_reject_non_media_extensions_and_query_bypass(self):
        invalid_urls = [
            "https://example.com/index.html",
            "https://example.com/page",
            "https://youtube.com/watch?v=12345",
            "https://example.com/page?anything=mp4",
            "https://example.com/article?format=m3u8",
        ]
        for url in invalid_urls:
            ok, err = validate_media_url(url)
            self.assertFalse(ok, f"Expected rejection for: {url}")
            self.assertIn("extension", err.lower())

    def test_reject_malformed_and_injection_characters(self):
        bad_inputs = [
            "",
            "   ",
            "https://example.com/test.mp4\x00evil",
            "https://example.com/test.mp4\nevil",
        ]
        for url in bad_inputs:
            ok, err = validate_media_url(url)
            self.assertFalse(ok, f"Expected rejection for bad input: {repr(url)}")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest host/tests/test_validator.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'host'`

- [ ] **Step 3: Implement strict `validate_media_url` in `host/validator.py`**

```python
# host/validator.py
import urllib.parse
import os

ALLOWED_SCHEMES = {"http", "https"}
ALLOWED_EXTENSIONS = {
    ".mp4", ".m3u8", ".mpd", ".webm", ".mkv",
    ".avi", ".flv", ".mov", ".ogg", ".ogv",
    ".ts", ".mp3", ".m4a", ".aac", ".wav", ".flac", ".opus"
}

def validate_media_url(url: str) -> tuple[bool, str]:
    if not isinstance(url, str):
        return False, "URL must be a string."
    
    cleaned = url.strip()
    if not cleaned:
        return False, "URL cannot be empty."

    if "\x00" in cleaned or "\n" in cleaned or "\r" in cleaned:
        return False, "URL contains illegal control characters."

    try:
        parsed = urllib.parse.urlsplit(cleaned)
    except Exception as e:
        return False, f"Malformed URL: {e}"

    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        return False, f"Unsupported scheme '{parsed.scheme}'. Only http and https are allowed."

    if not parsed.netloc:
        return False, "Missing hostname in URL."

    # Enforce allowed extension strictly on the URL path.
    # Query parameters are not permitted to qualify non-media paths.
    path = parsed.path
    _, ext = os.path.splitext(path)
    ext = ext.lower()

    if ext in ALLOWED_EXTENSIONS:
        return True, cleaned

    return False, f"URL path does not end with an allowed direct media extension ({', '.join(sorted(ALLOWED_EXTENSIONS))})."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python3 -m unittest host/tests/test_validator.py`
Expected: `Ran 4 tests in ... OK`

- [ ] **Step 5: Commit**

```bash
git add host/validator.py host/tests/test_validator.py
git commit -m "feat(host): add strict media url validation and query bypass prevention"
```

---

### Task 2: Native Messaging Protocol Framer and VLC Subprocess Launcher

**Files:**
- Create: `host/protocol.py`
- Create: `host/vlc_launcher.py`
- Create: `host/vlc_opener_host.py`
- Test: `host/tests/test_protocol.py`
- Test: `host/tests/test_launcher.py`

**Interfaces:**
- `read_message(stream) -> dict | None`: reads 4-byte prefix + UTF-8 JSON from input stream with 1MB bounds and error recovery.
- `write_message(stream, message: dict) -> None`: writes 4-byte prefix + UTF-8 JSON to output stream.
- `launch_vlc(url: str, vlc_bin: str = "vlc") -> tuple[bool, str]`: checks binary via shutil.which and spawns detached VLC process.

- [ ] **Step 1: Write failing tests for protocol framing and launcher**

```python
# host/tests/test_protocol.py
import io
import struct
import json
import unittest
from host.protocol import read_message, write_message, MAX_MESSAGE_SIZE

class TestProtocol(unittest.TestCase):
    def test_write_and_read_roundtrip(self):
        payload = {"url": "https://example.com/video.mp4"}
        out_stream = io.BytesIO()
        write_message(out_stream, payload)

        raw = out_stream.getvalue()
        length = struct.unpack("<I", raw[:4])[0]
        self.assertEqual(length, len(raw) - 4)

        in_stream = io.BytesIO(raw)
        result = read_message(in_stream)
        self.assertEqual(result, payload)

    def test_read_empty_stream_returns_none(self):
        in_stream = io.BytesIO(b"")
        self.assertIsNone(read_message(in_stream))

    def test_read_invalid_json_returns_none(self):
        bad_json = b"{not-valid-json"
        in_stream = io.BytesIO(struct.pack("<I", len(bad_json)) + bad_json)
        self.assertIsNone(read_message(in_stream))

    def test_read_non_dict_json_returns_none(self):
        list_json = b"[\"url\", \"https://example.com\"]"
        in_stream = io.BytesIO(struct.pack("<I", len(list_json)) + list_json)
        self.assertIsNone(read_message(in_stream))

    def test_read_oversized_message_returns_none(self):
        in_stream = io.BytesIO(struct.pack("<I", MAX_MESSAGE_SIZE + 100))
        self.assertIsNone(read_message(in_stream))

if __name__ == "__main__":
    unittest.main()
```

```python
# host/tests/test_launcher.py
import unittest
from unittest.mock import patch, MagicMock
from host.vlc_launcher import launch_vlc

class TestLauncher(unittest.TestCase):
    @patch("shutil.which", return_value="/usr/bin/vlc")
    @patch("subprocess.Popen")
    def test_launch_vlc_success(self, mock_popen, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_popen.return_value = mock_proc

        ok, msg = launch_vlc("https://example.com/test.mp4")
        self.assertTrue(ok)
        self.assertIn("9999", msg)

        mock_which.assert_called_once_with("vlc")
        mock_popen.assert_called_once()
        args, kwargs = mock_popen.call_args
        cmd = args[0]
        self.assertEqual(cmd, ["/usr/bin/vlc", "--", "https://example.com/test.mp4"])
        self.assertTrue(kwargs.get("start_new_session"))

    @patch("shutil.which", return_value=None)
    def test_launch_vlc_binary_missing(self, mock_which):
        ok, err = launch_vlc("https://example.com/test.mp4")
        self.assertFalse(ok)
        self.assertIn("not found", err.lower())

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. python3 -m unittest discover -s host/tests`
Expected: FAIL with `ModuleNotFoundError` for protocol and vlc_launcher.

- [ ] **Step 3: Implement `protocol.py`, `vlc_launcher.py`, and executable `vlc_opener_host.py`**

```python
# host/protocol.py
import sys
import json
import struct

MAX_MESSAGE_SIZE = 1024 * 1024  # 1MB bound

def read_message(stream=sys.stdin.buffer) -> dict | None:
    raw_length = stream.read(4)
    if len(raw_length) < 4:
        return None
    msg_length = struct.unpack("<I", raw_length)[0]
    if msg_length == 0 or msg_length > MAX_MESSAGE_SIZE:
        return None

    raw_body = stream.read(msg_length)
    if len(raw_body) < msg_length:
        return None

    try:
        decoded = raw_body.decode("utf-8")
        parsed = json.loads(decoded)
        if isinstance(parsed, dict):
            return parsed
        return None
    except Exception:
        return None

def write_message(stream, message: dict) -> None:
    encoded = json.dumps(message, ensure_ascii=False).encode("utf-8")
    stream.write(struct.pack("<I", len(encoded)))
    stream.write(encoded)
    stream.flush()
```

```python
# host/vlc_launcher.py
import subprocess
import shutil

def launch_vlc(url: str, vlc_bin: str = "vlc") -> tuple[bool, str]:
    resolved_bin = shutil.which(vlc_bin)
    if not resolved_bin:
        return False, f"VLC binary '{vlc_bin}' not found in PATH."

    try:
        proc = subprocess.Popen(
            [resolved_bin, "--", url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True, f"VLC started (pid: {proc.pid})"
    except Exception as e:
        return False, f"Failed to execute VLC: {e}"
```

```python
#!/usr/bin/env python3
# host/vlc_opener_host.py
import sys
import os

# Ensure host directory is in import path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from validator import validate_media_url
from protocol import read_message, write_message
from vlc_launcher import launch_vlc

def main():
    msg = read_message(sys.stdin.buffer)
    if msg is None:
        sys.exit(0)

    url = msg.get("url")
    if not url or not isinstance(url, str):
        write_message(sys.stdout.buffer, {
            "success": False,
            "error": "Missing or invalid 'url' field in request payload."
        })
        sys.exit(0)

    is_valid, validated_url_or_err = validate_media_url(url)
    if not is_valid:
        write_message(sys.stdout.buffer, {
            "success": False,
            "error": validated_url_or_err
        })
        sys.exit(0)

    launched, launch_info = launch_vlc(validated_url_or_err)
    if launched:
        write_message(sys.stdout.buffer, {
            "success": True,
            "message": launch_info,
            "url": validated_url_or_err
        })
    else:
        write_message(sys.stdout.buffer, {
            "success": False,
            "error": launch_info
        })

if __name__ == "__main__":
    main()
```

Make executable: `chmod +x host/vlc_opener_host.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. python3 -m unittest discover -s host/tests`
Expected: `Ran 9 tests in ... OK`

- [ ] **Step 5: Commit**

```bash
git add host/
git commit -m "feat(host): implement bounded native messaging protocol and detached vlc launcher"
```

---

### Task 3: Native Messaging Manifest and Host Installation Script

**Files:**
- Create: `host/vlc_opener.json`
- Create: `host/install_host.sh`

**Interfaces:**
- Consumes: installed python host at `~/.local/bin/vlc-opener-host`
- Produces: native messaging manifest in `~/.mozilla/native-messaging-hosts/vlc_opener.json` matching extension ID `vlc-opener@lyravein.my.id`

- [ ] **Step 1: Create native messaging host manifest template**

```json
{
  "name": "vlc_opener",
  "description": "Native helper to launch VLC with media URLs",
  "path": "/home/lyravein/.local/bin/vlc-opener-host",
  "type": "stdio",
  "allowed_extensions": [
    "vlc-opener@lyravein.my.id"
  ]
}
```

- [ ] **Step 2: Create install helper script**

```bash
#!/bin/bash
# host/install_host.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
MOZ_DIR="$HOME/.mozilla/native-messaging-hosts"
TARGET_BIN="$BIN_DIR/vlc-opener-host"
TARGET_MANIFEST="$MOZ_DIR/vlc_opener.json"

mkdir -p "$BIN_DIR"
mkdir -p "$MOZ_DIR"

# Symlink executable wrapper
ln -sf "$SCRIPT_DIR/vlc_opener_host.py" "$TARGET_BIN"
chmod +x "$TARGET_BIN"

# Generate manifest with exact target path
cat > "$TARGET_MANIFEST" <<EOF
{
  "name": "vlc_opener",
  "description": "Native helper to launch VLC with media URLs",
  "path": "$TARGET_BIN",
  "type": "stdio",
  "allowed_extensions": [
    "vlc-opener@lyravein.my.id"
  ]
}
EOF

echo "Installed native host to: $TARGET_BIN"
echo "Registered manifest to: $TARGET_MANIFEST"
```

- [ ] **Step 3: Test manifest JSON validity via python**

Run: `python3 -c "import json; m=json.load(open('host/vlc_opener.json')); assert m['name']=='vlc_opener'; assert 'vlc-opener@lyravein.my.id' in m['allowed_extensions']; print('Manifest syntax valid')"`
Expected: `Manifest syntax valid`

- [ ] **Step 4: Commit**

```bash
git add host/vlc_opener.json host/install_host.sh
git commit -m "feat(host): add installation script and firefox native manifest"
```

---

### Task 4: WebExtension Manifest & Static Assets

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon-48.png`
- Create: `extension/icons/icon-96.png`

**Interfaces:**
- Consumes: Firefox Manifest V3 schema
- Produces: Valid loadable extension folder for Firefox `about:debugging`

- [ ] **Step 1: Write `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Open in VLC",
  "version": "1.0.0",
  "description": "Open direct non-DRM media streams (.mp4, .m3u8, .mpd) in VLC.",
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
    "notifications"
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

- [ ] **Step 2: Generate clean PNG icons using Python stdlib**

```python
# Create minimal valid orange cone icon PNGs using Python stdlib
import zlib
import struct
import os

def create_simple_png(filepath, size, r=235, g=100, b=20):
    width, height = size, size
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)  # filter type none
        for x in range(width):
            dx = x - width / 2
            dy = y - height / 2
            if dx*dx + dy*dy <= (width/2 - 2)**2:
                raw_data.extend((r, g, b, 255))
            else:
                raw_data.extend((0, 0, 0, 0))

    def chunk(tag, data):
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", zlib.crc32(tag + data) & 0xffffffff)

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(bytes(raw_data)))
    iend = chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(header + ihdr + idat + iend)

create_simple_png("extension/icons/icon-48.png", 48)
create_simple_png("extension/icons/icon-96.png", 96)
print("Icons generated successfully")
```

- [ ] **Step 3: Verify manifest format and icon existence**

Run: `python3 -c "import json, os; m=json.load(open('extension/manifest.json')); assert os.path.exists('extension/' + m['icons']['48']); assert os.path.exists('extension/' + m['icons']['96']); print('Manifest and icons validated')"`
Expected: `Manifest and icons validated`

- [ ] **Step 4: Commit**

```bash
git add extension/
git commit -m "feat(extension): add manifest v3 and generated extension icons"
```

---

### Task 5: WebExtension Background Script (Context Menu and Toolbar Action)

**Files:**
- Create: `extension/background.js`

**Interfaces:**
- Consumes: Firefox WebExtensions APIs (`contextMenus`, `action`, `scripting`, `nativeMessaging`, `notifications`)
- Produces: Context menu item "Open in VLC" for link/video/audio contexts, and toolbar action button to scan active tab's `<video>` tag with DRM and blob rejection.

- [ ] **Step 1: Implement `extension/background.js`**

```javascript
// extension/background.js

const NATIVE_HOST_NAME = "vlc_opener";

// Register context menus
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "vlc-open-media",
    title: "Open in VLC",
    contexts: ["link", "video", "audio"]
  });
});

// Handle context menu clicks
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "vlc-open-media") {
    const candidate = info.srcUrl || info.linkUrl;
    if (candidate) {
      sendUrlToVlc(candidate);
    } else {
      notify("VLC Opener", "No media URL found in clicked target.");
    }
  }
});

// Function injected into active tab to inspect HTML5 <video> elements
function findPageVideoUrl() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length === 0) {
    return { found: false, error: "No video element found on this page." };
  }

  // Prioritize playing video, then paused video with currentTime > 0, then any video with src
  const activeVideo = videos.find(v => !v.paused && v.currentTime > 0)
    || videos.find(v => v.currentSrc || v.src)
    || videos[0];

  // Check for EME DRM protection
  if (activeVideo.mediaKeys) {
    return {
      found: false,
      error: "Video uses DRM (EME/mediaKeys). Cannot open encrypted streams in VLC."
    };
  }

  const rawUrl = activeVideo.currentSrc || activeVideo.src || (activeVideo.querySelector("source")?.src);

  if (!rawUrl) {
    return { found: false, error: "Video element has no readable source." };
  }

  if (rawUrl.startsWith("blob:") || rawUrl.startsWith("data:")) {
    return {
      found: false,
      error: "Video uses encrypted or blob MSE stream. Only direct URLs (.mp4, .m3u8, .mpd) can be opened in VLC."
    };
  }

  return { found: true, url: rawUrl };
}

// Handle toolbar icon click
browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: findPageVideoUrl
    });

    const outcome = results?.[0]?.result;
    if (!outcome) {
      notify("VLC Opener", "Could not scan current page for video.");
      return;
    }

    if (outcome.found && outcome.url) {
      sendUrlToVlc(outcome.url);
    } else {
      notify("VLC Opener", outcome.error || "No direct media URL found.");
    }
  } catch (err) {
    notify("VLC Opener", "Cannot read media on this tab: " + err.message);
  }
});

// Send URL to native messaging host
function sendUrlToVlc(url) {
  browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { url })
    .then((response) => {
      if (!response) {
        notify("VLC Opener", "Native host returned empty response.");
        return;
      }
      if (response.success) {
        notify("VLC Opener", "Launching VLC for: " + truncateUrl(response.url || url));
      } else {
        notify("VLC Opener Error", response.error || "Failed to launch VLC.");
      }
    })
    .catch((err) => {
      notify("VLC Opener Error", "Native host connection failed: " + err.message);
    });
}

function truncateUrl(url) {
  if (url.length <= 45) return url;
  return url.substring(0, 42) + "...";
}

function notify(title, message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-48.png",
    title: title,
    message: message
  });
}
```

- [ ] **Step 2: Check syntax and linting**

Run: `node -c extension/background.js`
Expected: Exit code 0 (no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): implement context menu, toolbar button, DRM detection, and native messaging"
```

---

### Task 6: End-to-End Pipeline Verification and User Documentation

**Files:**
- Create: `README.md`
- Test: manual integration test script `test_cli_pipe.sh`

**Interfaces:**
- Consumes: installed host and extension files
- Produces: verified communication between mock JSON input, host validator, VLC launcher, and documented loading steps in Firefox.

- [ ] **Step 1: Write integration test script simulating native messaging stdio**

```bash
#!/bin/bash
# test_cli_pipe.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PY="$SCRIPT_DIR/host/vlc_opener_host.py"

echo "=== Test 1: Valid media URL ==="
python3 -c "
import struct, json, sys
msg = json.dumps({'url': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'}).encode('utf-8')
sys.stdout.buffer.write(struct.pack('<I', len(msg)))
sys.stdout.buffer.write(msg)
" | python3 "$HOST_PY" | python3 -c "
import struct, json, sys
raw_len = sys.stdin.buffer.read(4)
length = struct.unpack('<I', raw_len)[0]
body = json.loads(sys.stdin.buffer.read(length).decode('utf-8'))
print('Host response:', body)
assert body.get('success') == True
"

echo "=== Test 2: Invalid scheme rejection ==="
python3 -c "
import struct, json, sys
msg = json.dumps({'url': 'file:///etc/passwd'}).encode('utf-8')
sys.stdout.buffer.write(struct.pack('<I', len(msg)))
sys.stdout.buffer.write(msg)
" | python3 "$HOST_PY" | python3 -c "
import struct, json, sys
raw_len = sys.stdin.buffer.read(4)
length = struct.unpack('<I', raw_len)[0]
body = json.loads(sys.stdin.buffer.read(length).decode('utf-8'))
print('Host response:', body)
assert body.get('success') == False
assert 'scheme' in body.get('error', '').lower()
"

echo "=== Test 3: Query parameter bypass rejection ==="
python3 -c "
import struct, json, sys
msg = json.dumps({'url': 'https://example.com/page?param=mp4'}).encode('utf-8')
sys.stdout.buffer.write(struct.pack('<I', len(msg)))
sys.stdout.buffer.write(msg)
" | python3 "$HOST_PY" | python3 -c "
import struct, json, sys
raw_len = sys.stdin.buffer.read(4)
length = struct.unpack('<I', raw_len)[0]
body = json.loads(sys.stdin.buffer.read(length).decode('utf-8'))
print('Host response:', body)
assert body.get('success') == False
assert 'extension' in body.get('error', '').lower()
"

echo "=== Test 4: Malformed JSON recovery ==="
python3 -c "
import struct, sys
bad = b'{invalid-json'
sys.stdout.buffer.write(struct.pack('<I', len(bad)))
sys.stdout.buffer.write(bad)
" | python3 "$HOST_PY" | python3 -c "
import sys
assert len(sys.stdin.buffer.read()) == 0
print('Clean exit on malformed payload')
"

echo "Integration pipeline tests PASSED."
```

- [ ] **Step 2: Run integration test script**

Run: `bash test_cli_pipe.sh`
Expected:
```
=== Test 1: Valid media URL ===
Host response: {'success': True, ...}
=== Test 2: Invalid scheme rejection ===
Host response: {'success': False, 'error': ...}
=== Test 3: Query parameter bypass rejection ===
Host response: {'success': False, 'error': ...}
=== Test 4: Malformed JSON recovery ===
Clean exit on malformed payload
Integration pipeline tests PASSED.
```

- [ ] **Step 3: Write `README.md` with Firefox installation steps**

Document:
1. Run `bash host/install_host.sh` to install native messaging host to `~/.local/bin` and `~/.mozilla/native-messaging-hosts`.
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
3. Click "Load Temporary Add-on..." and select `manifest.json` from `extension/`.
4. Test by right-clicking any direct `.mp4`, `.m3u8`, or `.mpd` link -> "Open in VLC", or clicking the extension icon while watching a direct video.

- [ ] **Step 4: Commit**

```bash
git add README.md test_cli_pipe.sh
git commit -m "docs: add pipeline test and firefox installation instructions"
```

---

### Task 7: GitHub Publication and Release Push

**Files:**
- Local git repository

**Interfaces:**
- Consumes: committed project files on `main` branch
- Produces: synced remote repository at `https://github.com/Lyravein/firefox-vlc-opener`

- [ ] **Step 1: Push main branch to remote origin**

```bash
git push -u origin main
```

- [ ] **Step 2: Verify repository state on GitHub**

Run: `gh repo view Lyravein/firefox-vlc-opener --json name,pushedAt,defaultBranchRef`
Expected: `defaultBranchRef` is `main`, commits visible on GitHub.

---

## Risks, Tradeoffs, and Open Questions

1. **Blob and MSE players (YouTube, Twitch, Netflix):**
   - Direct DOM inspection cannot extract raw media URLs from MSE (Media Source Extensions) `blob:http...` objects without hooking internal player buffers or tokens, which violates the safety boundary set by the user. The plan explicitly detects `blob:` and DRM `mediaKeys` and alerts the user cleanly rather than launching VLC with an invalid link.
2. **Temporary Add-on persistence in Firefox:**
   - Add-ons loaded via `about:debugging` are removed when Firefox restarts unless signed or loaded in Firefox Developer Edition / Nightly with `xpinstall.signatures.required = false`. The plan notes this clearly for daily usage.
3. **Dual Trigger Advantage:**
   - Both context menu (links and media tags) and toolbar action are implemented together in the same background script. This gives the best of both worlds with minimal code overhead.
4. **Repository Ownership:**
   - Repository is explicitly pinned to `Lyravein/firefox-vlc-opener`.
