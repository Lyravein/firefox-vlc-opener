#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
MOZ_DIR="$HOME/.mozilla/native-messaging-hosts"

mkdir -p "$BIN_DIR" "$MOZ_DIR"
TARGET_BIN="$BIN_DIR/vlc-opener-host"

ln -sf "$SCRIPT_DIR/vlc_opener_host.py" "$TARGET_BIN"
chmod +x "$TARGET_BIN" "$SCRIPT_DIR/vlc_opener_host.py"

cat > "$MOZ_DIR/vlc_opener.json" <<EOF
{
  "name": "vlc_opener",
  "description": "Native helper to launch VLC with media URLs",
  "path": "$TARGET_BIN",
  "type": "stdio",
  "allowed_extensions": ["vlc-opener@lyravein.my.id"]
}
EOF

printf 'Installed binary: %s\nRegistered manifest: %s\n' "$TARGET_BIN" "$MOZ_DIR/vlc_opener.json"
