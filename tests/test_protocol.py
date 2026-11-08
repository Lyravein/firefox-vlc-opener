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

    def test_write_oversized_message_raises_or_safe(self):
        oversized = {"big": "x" * (MAX_MESSAGE_SIZE + 100)}
        out_stream = io.BytesIO()
        with self.assertRaises(ValueError):
            write_message(out_stream, oversized)

if __name__ == "__main__":
    unittest.main()
