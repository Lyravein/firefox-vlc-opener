import json
import struct
import sys

MAX_MESSAGE_SIZE = 1024 * 1024


def read_message(stream=sys.stdin.buffer) -> dict | None:
    try:
        raw_length = stream.read(4)
        if len(raw_length) < 4:
            return None
        msg_length = struct.unpack("<I", raw_length)[0]
        if msg_length == 0 or msg_length > MAX_MESSAGE_SIZE:
            return None
        raw_message = stream.read(msg_length)
        if len(raw_message) < msg_length:
            return None
        message = json.loads(raw_message.decode("utf-8"))
        return message if isinstance(message, dict) else None
    except Exception:
        return None


def write_message(stream, message: dict) -> None:
    encoded = json.dumps(message, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_MESSAGE_SIZE:
        raise ValueError("Message exceeds maximum size of 1MB")
    stream.write(struct.pack("<I", len(encoded)))
    stream.write(encoded)
    stream.flush()
