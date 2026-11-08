import os
from urllib.parse import urlsplit


_MEDIA_EXTENSIONS = {
    ".mp4", ".m3u8", ".mpd", ".webm", ".mkv", ".avi", ".flv",
    ".mov", ".ogg", ".ogv", ".ts", ".mp3", ".m4a", ".aac",
    ".wav", ".flac", ".opus",
}


def validate_media_url(url: str) -> tuple[bool, str]:
    if not isinstance(url, str) or not url or any(c in url for c in "\x00\n\r"):
        return False, "Invalid URL input"
    cleaned = url.strip()
    if not cleaned:
        return False, "Invalid URL input"

    try:
        parsed = urlsplit(cleaned)
    except ValueError:
        return False, "Invalid URL"

    if parsed.scheme.lower() not in ("http", "https"):
        return False, "Unsupported URL scheme"
    if "@" in parsed.netloc:
        return False, "URL credentials are not allowed"
    try:
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False, "Invalid URL authority or port"
    if not hostname:
        return False, "Invalid URL hostname"
    if port is not None and not 1 <= port <= 65535:
        return False, "Invalid URL port"

    if os.path.splitext(parsed.path)[1].lower() not in _MEDIA_EXTENSIONS:
        return False, "Invalid media extension"
    return True, cleaned
