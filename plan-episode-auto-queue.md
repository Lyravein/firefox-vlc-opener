# Episode Detection, Badge, and Auto-Queue Next Episode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic episode detection, an episode count badge on the in-page floating button, and seamless next-episode auto-queuing into VLC for multi-episode streaming pages.

**Architecture:** A pure JavaScript DOM parser module (`extension/episode_detector.js`) discovers episode links and current episode index from webpage DOM structures. The floating button content script (`extension/floating.js`) displays an isolated episode pill (`Ep X / Y`) and passes next-episode metadata to the background script. The background script (`extension/background.js`) coordinates playing the active stream and enqueuing the resolved next episode into VLC via native messaging with `--one-instance --playlist-enqueue`, alerting the user with "There's no episode left" when the final episode is reached.

**Tech Stack:** JavaScript (WebExtensions Manifest V3, Shadow DOM), Python 3 stdlib, VLC CLI (`--one-instance`, `--playlist-enqueue`), Node.js (unit test runner), pytest.

**Spec:** User request to detect total episodes on streaming sites, display episode count, queue the next episode into the VLC playlist automatically, and notify "There's no episode left" when reaching the end of the series.

## Global Constraints

- Working folder: `/home/lyravein/Documents/Playground/work/vlc-opener`
- GitHub repository: `Lyravein/firefox-vlc-opener`
- No em-dashes in any file, comment, commit message, or document (use colons, commas, or parentheses).
- Python standard library only for host helper scripts (no external pip dependencies).
- Strict validation: schemes must remain http or https only, no credentials or injection characters.
- Backward compatibility: standalone single video playback and context menus must continue working unchanged.

## Review Focus

1. Pages without episode lists (e.g. single YouTube videos or direct MP4 links): parser returns null/empty without throwing errors; requires `totalEpisodes >= 2` before rendering pill or enabling episode logic.
2. Final episode reached: only triggers notification "There's no episode left" when `currentEpisode !== null && totalEpisodes >= 2 && nextEpisode === null`.
3. Sequential launch ordering: `sendUrlToVlc` returns `{ ok, response }` and `handleVlcTrigger` `await`s the primary episode launch succeeding before triggering background enqueue of `nextEpisode`.
4. URL resolution: `parseEpisodes` resolves relative URLs against `documentContext.url` using `new URL(rel, base).href` and ignores non-URL option values.
5. VLC instance management: `--one-instance` ensures single window; `--playlist-enqueue` appends to playlist without opening second VLC window. Existing tests in `tests/test_launcher.py` updated to expect `--one-instance`.

---

### Task 1: VLC Launcher and Host Protocol Enqueue Support

**Files:**
- Modify: `host/vlc_launcher.py`
- Modify: `host/vlc_opener_host.py`
- Test: `tests/test_launcher.py`

**Interfaces:**
- Consumes: `launch_vlc(url, referer, mode, enqueue, vlc_bin, ytdlp_bin)`
- Produces: `enqueue` boolean flag passed to `vlc_cmd` (`--one-instance`, `--playlist-enqueue`)

- [ ] **Step 1: Write failing unit tests in `tests/test_launcher.py`**

Add unit tests verifying that:
1. `launch_vlc(..., enqueue=False)` includes `"--one-instance"` in the command args.
2. `launch_vlc(..., enqueue=True)` includes both `"--one-instance"` and `"--playlist-enqueue"` in the command args.
3. `vlc_opener_host.py` passes `enqueue=True` when `{"enqueue": true}` is in the JSON payload.

```python
def test_launch_vlc_enqueue_flag(self):
    with patch("shutil.which", return_value="/usr/bin/vlc"):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = MagicMock()
            mock_proc.pid = 9999
            mock_popen.return_value = mock_proc
            ok, msg = launch_vlc("https://example.com/test.mp4", enqueue=True)
            assert ok is True
            args = mock_popen.call_args[0][0]
            assert "--one-instance" in args
            assert "--playlist-enqueue" in args
```

- [ ] **Step 2: Run pytest to verify test failure**

Run: `/usr/bin/python3 -m pytest tests/test_launcher.py -k test_launch_vlc_enqueue_flag -v`
Expected: FAIL (argument `enqueue` unexpected or flag missing).

- [ ] **Step 3: Implement enqueue support in `host/vlc_launcher.py` and `host/vlc_opener_host.py`, and update existing tests in `tests/test_launcher.py`**

In `host/vlc_launcher.py`:
- Update signature: `def launch_vlc(url: str, referer: str | None = None, mode: str = "direct", enqueue: bool = False, vlc_bin: str = "vlc", ytdlp_bin: str = "yt-dlp") -> tuple[bool, str]:`
- Add `--one-instance` unconditionally to `vlc_cmd`.
- If `enqueue` is True, append `--playlist-enqueue` to `vlc_cmd`.

In `host/vlc_opener_host.py`:
- Extract `enqueue = bool(data.get("enqueue", False))`.
- Forward `enqueue=enqueue` to `launch_vlc`.
- Include `"enqueue": enqueue` in successful host response.

In `tests/test_launcher.py`:
- Update existing `self.assertEqual(cmd, ...)` checks at lines 22, 42, and 79 to expect `"--one-instance"`.

- [ ] **Step 4: Run pytest to verify tests pass**

Run: `/usr/bin/python3 -m pytest tests/test_launcher.py -v`
Expected: 26 passed.

- [ ] **Step 5: Commit**

```bash
git add host/vlc_launcher.py host/vlc_opener_host.py tests/test_launcher.py
git commit -m "feat(host): add one-instance and playlist-enqueue support to VLC launcher"
```

---

### Task 2: Pure Episode Detector Module and Unit Tests

**Files:**
- Create: `extension/episode_detector.js`
- Create: `tests/test_episode_detector.js`

**Interfaces:**
- Produces: `parseEpisodes(docInfo)` returning `{ episodes: Array<{ number: number, url: string, title: string }>, currentEpisode: number | null, totalEpisodes: number, nextEpisode: { number: number, url: string } | null }`

- [ ] **Step 1: Write failing test in `tests/test_episode_detector.js`**

Create test file covering:
1. Standard anime link list (`<a href="/ep-1">Episode 1</a>`, `<a href="/ep-2">Episode 2</a>`).
2. Sokuja-style episode lists and select dropdowns.
3. Correct detection of `currentEpisode` based on active page URL.
4. Correct identification of `nextEpisode` (e.g. from episode 1 -> episode 2).
5. Identification of final episode (`nextEpisode === null`).
6. Fallback when page has no episode links (returns empty list).

- [ ] **Step 2: Run Node test to verify test failure**

Run: `node tests/test_episode_detector.js`
Expected: FAIL (`Cannot find module '../extension/episode_detector.js'`).

- [ ] **Step 3: Implement `extension/episode_detector.js`**

Implement `parseEpisodes(documentContext)`:
- Extract all anchor elements `<a href="...">` and option elements `<option value="...">`.
- Resolve relative URLs against `documentContext.url` using `new URL(rawHref, documentContext.url).href`. Ignore non-URL values (e.g. javascript:, #, empty).
- Regex patterns for episode number extraction:
  `/(?:episode|eps|ep)[.\s-]*(\d+)/i`
  `/(?:^|\/)ep(?:isode)?[.-]?(\d+)(?:\.html|\/|$)/i`
- Extract resolved absolute URLs and integer episode numbers.
- Deduplicate by episode number and sort ascending.
- If total detected episodes < 2, return empty structure (avoids false-positive detection on single videos).
- Determine `currentEpisode`:
  - Check current URL against episode links.
  - Check elements with classes like `.active`, `.current`, `[selected]`.
  - Check `documentContext.title` or `documentContext.url` for `episode-(\d+)`.
- Calculate `totalEpisodes = episodes.length`.
- Find `nextEpisode`:
  - Find item in sorted episodes where `number === currentEpisode + 1` or the item immediately following `currentEpisode`.
  - If current is highest or not found, return null.
- Export for both CommonJS and browser environments.

- [ ] **Step 4: Run Node test to verify pass**

Run: `node tests/test_episode_detector.js`
Expected: PASS ("Episode detector unit tests PASSED").

- [ ] **Step 5: Commit**

```bash
git add extension/episode_detector.js tests/test_episode_detector.js
git commit -m "feat(extension): implement DOM episode detector with next episode resolution"
```

---

### Task 3: In-Page Floating Button Episode Badge UI

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/floating.js`

**Interfaces:**
- Consumes: `parseEpisodes` from `extension/episode_detector.js`
- Produces: Episode pill UI in Shadow DOM, passing `nextEpisode` and `isLast` on click

- [ ] **Step 1: Update `extension/manifest.json` to load `episode_detector.js` before `floating.js`**

In `content_scripts`:
```json
"js": ["episode_detector.js", "floating.js"]
```

- [ ] **Step 2: Update `extension/floating.js` styles and DOM structure**

Add styles and elements inside the Shadow Root:
- Style for container: flex container aligning the episode pill and the main VLC button.
- Style for `.ep-pill`:
  - Positioned beside or atop the button, dark background (`#1a1e28`), orange or silver border, font size 11px, font weight bold, padding 2px 8px, border-radius 10px.
  - Hover tooltip showing full text: `Episode X of Y (Click to play and queue next)`.
- Scan DOM on load:
  ```javascript
  const epInfo = parseEpisodes({
    url: window.location.href,
    title: document.title,
    links: Array.from(document.querySelectorAll("a[href]")).map(a => ({ href: a.href, text: a.textContent, className: a.className })),
    options: Array.from(document.querySelectorAll("select option")).map(o => ({ value: o.value, text: o.textContent, selected: o.selected }))
  });
  ```
- If `epInfo.totalEpisodes > 0`:
  - Render pill: `Ep ${epInfo.currentEpisode || "?"}/${epInfo.totalEpisodes}`.
  - If `epInfo.currentEpisode === epInfo.totalEpisodes`: add class `.final-ep` (silver badge).

- [ ] **Step 3: Update click action in `extension/floating.js`**

When button is clicked:
Re-run episode scan to capture any dynamically rendered elements:
```javascript
const currentEpInfo = scanPageEpisodes();
```
Send message to background script including episode context:
```javascript
browser.runtime.sendMessage({
  action: "TRIGGER_VLC",
  nextEpisode: currentEpInfo.nextEpisode,
  currentEpisode: currentEpInfo.currentEpisode,
  totalEpisodes: currentEpInfo.totalEpisodes,
  isLast: Boolean(currentEpInfo.totalEpisodes >= 2 && currentEpInfo.currentEpisode !== null && !currentEpInfo.nextEpisode)
});
```

- [ ] **Step 4: Verify syntax and linting**

Run: `node -c extension/floating.js && node -c extension/episode_detector.js`
Expected: Clean exit 0.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/floating.js
git commit -m "feat(extension): display episode count badge on floating button"
```

---

### Task 4: Background Script Auto-Queue Coordination and Notifications

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `action: "TRIGGER_VLC"`, `nextEpisode`, `isLast` from `floating.js`
- Produces: Launch active stream to VLC (`enqueue: false`), followed by background resolution and enqueue of next episode (`enqueue: true`), or "There's no episode left" notification

- [ ] **Step 1: Update `sendUrlToVlc` and `handleVlcTrigger` in `extension/background.js`**

Update `sendUrlToVlc(url, referer = null, isDirect = false, enqueue = false)`:
- Returns `{ ok: boolean, response: object }`.
- On error or response.success === false, returns `{ ok: false, response }`.

Update `handleVlcTrigger` to accept `meta = {}`:
1. Launch current episode in VLC sequentially:
   - If stream captured by sniffer: `const res = await sendUrlToVlc(best.url, best.referer, true, false);`
   - Else fallback: `const res = await sendUrlToVlc(candidateUrl, tab.url, false, false);`
2. Process next episode queuing only after primary launch succeeds:
   - If `res?.ok && meta.nextEpisode`:
     - Show initial status notification: `Playing Episode ${meta.currentEpisode}. Buffering Episode ${meta.nextEpisode.number} into playlist...`.
     - Send native message to host:
       `const queueRes = await sendUrlToVlc(meta.nextEpisode.url, tab.url, false, true);`
     - On host response:
       - If success: `notify("VLC Opener", "Enqueued Episode " + meta.nextEpisode.number + " into VLC playlist.")`
       - If failure: `notify("VLC Opener", "Next episode could not be auto-queued: " + queueRes.response?.error)`
   - Else if `res?.ok && meta.isLast`:
     - Show notification:
       `notify("VLC Opener", "There's no episode left! (Enjoy the final episode)")`

- [ ] **Step 2: Update runtime message listener in `extension/background.js`**

Forward `meta` payload from `TRIGGER_VLC` message into `handleVlcTrigger(tab, message)`.

- [ ] **Step 3: Verify syntax**

Run: `node -c extension/background.js`
Expected: Clean exit 0.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): auto-queue next episode into VLC and alert on final episode"
```

---

### Task 5: Integration Tests and Pipeline Verification

**Files:**
- Modify: `test_cli_pipe.sh`
- Modify: `README.md`

**Interfaces:**
- Verifies: full pipeline end-to-end with `--playlist-enqueue` assertions

- [ ] **Step 1: Update `test_cli_pipe.sh`**

Add tests verifying:
1. Calling host with `{"url": "https://example.com/video1.mp4", "enqueue": false}` launches VLC without `--playlist-enqueue`.
2. Calling host with `{"url": "https://example.com/video2.mp4", "enqueue": true}` launches VLC with `--playlist-enqueue` and `--one-instance`.
3. Calling host with `{"url": "https://example.com/anime/ep-2", "enqueue": true}` resolves via mock yt-dlp and launches VLC with `--playlist-enqueue`.

- [ ] **Step 2: Run pipeline test**

Run: `bash test_cli_pipe.sh`
Expected: "All pipeline tests passed."

- [ ] **Step 3: Update `README.md`**

Document:
- Episode detection badge (`Ep X / Y`).
- Automatic next-episode queuing in VLC (`--playlist-enqueue`).
- Final episode detection and notification behavior.

- [ ] **Step 4: Commit**

```bash
git add test_cli_pipe.sh README.md
git commit -m "test: add integration tests for playlist enqueue and update documentation"
```

---

## Verification Checklist

1. `/usr/bin/python3 -m pytest -v`: all Python unit tests pass (26+ tests).
2. `node tests/test_episode_detector.js`: all episode detector tests pass.
3. `node tests/test_stream_tracker.js`: stream tracker tests pass.
4. `bash test_cli_pipe.sh`: full CLI mock pipeline tests pass.
5. `grep -rn $'\u2014' . --exclude-dir=.git`: no em-dashes found anywhere in the repository.
