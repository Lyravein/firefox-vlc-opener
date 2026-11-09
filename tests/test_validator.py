import unittest
from host.validator import validate_media_url, validate_request

class TestMediaUrlValidator(unittest.TestCase):
    def test_valid_http_media_urls(self):
        valid_urls = [
            "https://cdn.example.com/video.mp4",
            "http://example.org/stream/index.m3u8",
            "https://streams.site.net/manifest.mpd?token=abc123",
            "https://media.org/clip.webm#t=10",
            "https://media.example.com:8080/stream.mp4",
            "http://[::1]:8080/test.mp4",
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
            "https://example.com/test.mp4\revil",
        ]
        for url in bad_inputs:
            ok, err = validate_media_url(url)
            self.assertFalse(ok, f"Expected rejection for bad input: {repr(url)}")

    def test_reject_adversarial_authority_and_invalid_ports(self):
        adversarial_urls = [
            "https://@/video.mp4",
            "https:///video.mp4",
            "https://user:pass@example.com/video.mp4",
            "https://example.com:999999/video.mp4",
            "https://example.com:abc/video.mp4",
            "https://example.com:-80/video.mp4",
        ]
        for url in adversarial_urls:
            ok, err = validate_media_url(url)
            self.assertFalse(ok, f"Expected rejection for adversarial URL: {url}")

    def test_valid_direct_media_with_referer(self):
        ok, mode, url, ref = validate_request(
            "https://cdn.example.com/stream.m3u8",
            referer="https://anime.example.com/watch/123"
        )
        self.assertTrue(ok)
        self.assertEqual(mode, "direct")
        self.assertEqual(url, "https://cdn.example.com/stream.m3u8")
        self.assertEqual(ref, "https://anime.example.com/watch/123")

    def test_valid_direct_with_is_direct_hint(self):
        ok, mode, url, ref = validate_request(
            "https://cdn.example.com/stream_without_extension?token=abc",
            is_direct=True
        )
        self.assertTrue(ok)
        self.assertEqual(mode, "direct")

    def test_valid_page_url_for_ytdlp_mode(self):
        ok, mode, url, ref = validate_request(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            referer=None
        )
        self.assertTrue(ok)
        self.assertEqual(mode, "ytdlp")
        self.assertEqual(url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertIsNone(ref)

    def test_reject_dangerous_referer(self):
        ok, mode, err, ref = validate_request(
            "https://cdn.example.com/stream.mp4",
            referer="javascript:alert(1)"
        )
        self.assertFalse(ok)
        self.assertIn("referer", err.lower())

    def test_reject_referer_with_control_chars(self):
        ok, mode, err, ref = validate_request(
            "https://cdn.example.com/stream.mp4",
            referer="https://example.com/\x00evil"
        )
        self.assertFalse(ok)

    def test_reject_referer_credentials_and_bad_port(self):
        bad_referers = [
            "https://user:pass@example.com/",
            "https://example.com:999999/",
            "https://@/",
        ]
        for ref in bad_referers:
            ok, mode, err, cleaned_ref = validate_request(
                "https://cdn.example.com/stream.mp4",
                referer=ref
            )
            self.assertFalse(ok)
            self.assertIn("referer", err.lower())

if __name__ == "__main__":
    unittest.main()
