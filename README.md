# Firefox VLC Opener

Firefox VLC Opener is a Firefox extension and Linux native messaging host for opening direct media URLs in VLC. It supports `.mp4`, `.m3u8`, `.mpd`, and `.webm` media.

## Security and scope

This project handles strictly non-DRM direct URLs. It does not bypass DRM or extract cookies or tokens. URLs are passed to VLC using safe subprocess arguments with `--`. Only `http` and `https` schemes are allowed, and the URL path must have a supported media extension. Native messaging protocol messages are bounded to 1 MB. The extension checks the page media element's `mediaKeys` property to avoid DRM-protected media.

## Prerequisites

- Linux
- Firefox
- VLC (`pacman -S vlc`)
- Python 3

## Setup

1. Install the native messaging host:

   ```bash
   bash host/install_host.sh
   ```

   This installs the wrapper to `~/.local/bin/vlc-opener-host` and registers the manifest at `~/.mozilla/native-messaging-hosts/vlc_opener.json`.

2. Load the extension in Firefox. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select `extension/manifest.json`.

3. Temporary add-ons unload when Firefox restarts. For a permanent local installation, use Firefox Developer Edition or Nightly with `xpinstall.signatures.required = false`, or package the extension with `web-ext`.

## Usage

- Right-click a direct link or media element and choose **Open in VLC**.
- Click the extension toolbar icon while watching an active video.

## Running tests

```bash
python3 -m pytest -v
bash test_cli_pipe.sh
```
