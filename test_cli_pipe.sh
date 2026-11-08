#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp_dir/bin/vlc"
chmod +x "$tmp_dir/bin/vlc"
export PATH="$tmp_dir/bin:$PATH"

python3 - "$repo_dir/host/vlc_opener_host.py" <<'PY'
import json
import struct
import subprocess
import sys

host = sys.argv[1]

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
expect_error("file:///etc/passwd", "scheme")
expect_error("https://example.com/page?param=mp4", "extension")
response = run(json.dumps({"url": "https://@/video.mp4"}).encode())
assert response.get("success") is False, response
assert any(word in str(response.get("error", "")).lower() for word in ("authority", "hostname", "credentials")), response

# Malformed framing is handled without hanging or crashing the host.
result = subprocess.run(
    [sys.executable, host], input=b"\x01\x02\x03", stdout=subprocess.PIPE,
    stderr=subprocess.PIPE, check=False, timeout=5,
)
assert result.returncode == 0, (result.returncode, result.stderr)
print("All 5 pipeline tests passed.")
PY
