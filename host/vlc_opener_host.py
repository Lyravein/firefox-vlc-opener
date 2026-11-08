#!/usr/bin/env python3
import os
import sys

_HOST_DIR = os.path.dirname(os.path.realpath(__file__))
if _HOST_DIR not in sys.path:
    sys.path.insert(0, _HOST_DIR)

from protocol import read_message, write_message
from validator import validate_media_url
from vlc_launcher import launch_vlc


def main() -> None:
    message = read_message(sys.stdin.buffer)
    if message is None:
        return
    if "url" not in message or not isinstance(message["url"], str):
        write_message(sys.stdout.buffer, {"success": False, "error": "Missing or invalid 'url' in message payload"})
        return

    valid, result = validate_media_url(message["url"])
    if not valid:
        write_message(sys.stdout.buffer, {"success": False, "error": result})
        return
    launched, launch_msg = launch_vlc(result)
    if launched:
        write_message(sys.stdout.buffer, {"success": True, "message": launch_msg, "url": result})
    else:
        write_message(sys.stdout.buffer, {"success": False, "error": launch_msg})


if __name__ == "__main__":
    main()
