#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/bin"
export VLC_LOG="$tmp_dir/vlc-args.log"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "$VLC_LOG"\nexit 0\n' > "$tmp_dir/bin/vlc"
printf '#!/usr/bin/env bash\ntouch "$YTDLP_CALLED"\nprintf "%%s\\n" "https://resolved.example.com/playlist.m3u8"\n' > "$tmp_dir/bin/yt-dlp"
chmod +x "$tmp_dir/bin/vlc" "$tmp_dir/bin/yt-dlp"
export YTDLP_CALLED="$tmp_dir/ytdlp-called"
export PATH="$tmp_dir/bin:$PATH"

ln -s "$repo_dir/host/vlc_opener_host.py" "$tmp_dir/bin/vlc-opener-host"
python3 - "$repo_dir/host/vlc_opener_host.py" "$tmp_dir/bin/vlc-opener-host" <<'PY'
import json
import os
import struct
import subprocess
import sys

host = sys.argv[1]
symlink = sys.argv[2]

def run(payload):
    framed = struct.pack("<I", len(payload)) + payload
    result = subprocess.run(
        [sys.executable, host], input=framed, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False, timeout=5,
    )
    if result.returncode != 0:
        raise AssertionError(f"host exited {result.returncode}: {result.stderr!r}")
    if len(result.stdout) < 4:
        raise AssertionError(f"missing response: {result.stdout!r}")
    size = struct.unpack("<I", result.stdout[:4])[0]
    return json.loads(result.stdout[4:4 + size])

def expect_error(payload, word):
    response = run(json.dumps({"url": payload}).encode())
    assert response.get("success") is False, response
    assert word in str(response.get("error", "")).lower(), response

response = run(json.dumps({"url": "https://example.com/sample.mp4"}).encode())
assert response.get("success") is True, response
response = run(json.dumps({"url": "https://example.com/video1.mp4", "enqueue": False}).encode())
assert response.get("success") is True and response.get("enqueue") is False, response
response = run(json.dumps({"url": "https://example.com/video2.mp4", "enqueue": True}).encode())
assert response.get("success") is True and response.get("enqueue") is True, response
with open(os.environ["VLC_LOG"], encoding="utf-8") as log:
    last_vlc_args = log.readlines()[-1]
assert "--one-instance" in last_vlc_args and "--playlist-enqueue" in last_vlc_args, last_vlc_args
response = run(json.dumps({"url": "https://example.com/anime/episode-1", "referer": "https://example.com/"}).encode())
assert response.get("success") is True and response.get("mode") == "ytdlp", response
import os
assert os.path.exists(os.environ["YTDLP_CALLED"]), "yt-dlp mock was not called"
response = run(json.dumps({"url": "https://cdn.example.com/video.mp4", "referer": "https://anime.com"}).encode())
assert response.get("success") is True and response.get("mode") == "direct", response
response = run(json.dumps({"url": "https://example.com/video", "is_direct": True}).encode())
assert response.get("success") is True and response.get("mode") == "direct", response
expect_error("file:///etc/passwd", "scheme")
response = run(json.dumps({"url": "https://example.com/page?param=mp4"}).encode())
assert response.get("success") is True and response.get("mode") == "ytdlp", response
response = run(json.dumps({"url": "https://cdn.example.com/video.mp4", "referer": "file:///etc/passwd"}).encode())
assert response.get("success") is False, response
assert "referer" in str(response.get("error", "")).lower(), response
response = run(json.dumps({"url": "https://@/video.mp4"}).encode())
assert response.get("success") is False, response
assert any(word in str(response.get("error", "")).lower() for word in ("authority", "hostname", "credentials")), response

# Malformed framing is handled without hanging or crashing the host.
result = subprocess.run(
    [sys.executable, host], input=b"\x01\x02\x03", stdout=subprocess.PIPE,
    stderr=subprocess.PIPE, check=False, timeout=5,
)
assert result.returncode == 0, (result.returncode, result.stderr)

# Test 6: invoking through a symlink in another directory loads sibling modules.
framed = struct.pack("<I", len(json.dumps({"url": "https://example.com/sample.mp4"}).encode())) + json.dumps({"url": "https://example.com/sample.mp4"}).encode()
result = subprocess.run(
    [symlink], input=framed, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    check=False, timeout=5,
)
assert result.returncode == 0, (result.returncode, result.stderr)
size = struct.unpack("<I", result.stdout[:4])[0]
response = json.loads(result.stdout[4:4 + size])
assert response.get("success") is True, response
print("All pipeline tests passed.")

PY
