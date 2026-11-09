# Firefox VLC Opener

Firefox VLC Opener is a Firefox extension and Linux native messaging host for opening media in VLC. It combines a passive network media sniffer, a yt-dlp fallback resolver, and hotlink referer forwarding.

## Features

1. **Passive Network Media Sniffer:** Intercepts master playlists (`.m3u8`, `.mpd`) and direct video files (`.mp4`, `.webm`) across pages and embedded iframes. A `▶` badge appears on the toolbar button when media is detected.
2. **yt-dlp Fallback Resolver:** If no direct stream is captured, clicking the extension icon or right-clicking a web page uses local `yt-dlp` to extract the underlying video stream.
3. **Hotlink Referer Forwarding:** Automatically captures and passes the wire `Referer` to VLC using `--http-referrer`, helping prevent CDN 403 Forbidden errors.
4. **In-Page Floating Button:** A lightweight draggable button injected into pages using Shadow DOM, allowing one-click VLC playback on websites that disable or intercept right-click context menus.

## Security and scope

This project handles strictly non-DRM media. It does not bypass DRM or extract cookies or tokens. URLs are passed to VLC using safe subprocess arguments with `--`. Only `http` and `https` schemes are allowed. Native messaging protocol messages are bounded to 1 MB, and the extension avoids DRM-protected media.

## Prerequisites

- Linux
- Firefox
- VLC (`pacman -S vlc`)
- Python 3
- Optional: yt-dlp (`pacman -S yt-dlp`) for resolving web pages without a captured direct stream

## Installation

1. Install the native messaging host:

   ```bash
   bash host/install_host.sh
   ```

   This installs the wrapper to `~/.local/bin/vlc-opener-host` and registers the manifest at `~/.mozilla/native-messaging-hosts/vlc_opener.json`.

2. Load the extension in Firefox. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select `extension/manifest.json`.

3. Temporary add-ons unload when Firefox restarts. For a permanent local installation, use Firefox Developer Edition or Nightly with `xpinstall.signatures.required = false`, or package the extension with `web-ext`.

## Usage

- Browse to a page with media. The toolbar button shows a `▶` badge when a stream is detected; click it to open the captured stream in VLC.
- Right-click a direct media link or media element and choose **Open in VLC**.
- Click the draggable floating button on the page (marked with a green glowing indicator when a stream or video is detected) to launch VLC directly without using context menus.
- If no direct stream was captured, click the extension icon or right-click the web page to ask local yt-dlp to resolve the stream. Install yt-dlp for this fallback.
- The captured request Referer is forwarded automatically to VLC for hotlink-protected streams.

## Running tests

```bash
python3 -m pytest -v
bash test_cli_pipe.sh
```
