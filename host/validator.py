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


def validate_request(
    url: str, referer: str | None = None, is_direct: bool = False
) -> tuple[bool, str, str, str | None]:
    def validate(value: str, label: str) -> tuple[bool, str, object | None]:
        if not isinstance(value, str) or not value or any(c in value for c in "\x00\n\r"):
            return False, f"Invalid {label} input", None
        cleaned_value = value.strip()
        if not cleaned_value:
            return False, f"Invalid {label} input", None
        try:
            parsed_value = urlsplit(cleaned_value)
        except ValueError:
            return False, f"Invalid {label}", None
        if parsed_value.scheme.lower() not in ("http", "https"):
            return False, f"Unsupported {label} scheme", None
        if "@" in parsed_value.netloc:
            return False, f"{label} credentials are not allowed", None
        try:
            hostname = parsed_value.hostname
            port = parsed_value.port
        except ValueError:
            return False, f"Invalid {label} authority or port", None
        if not hostname:
            return False, f"Invalid {label} hostname", None
        if port is not None and not 1 <= port <= 65535:
            return False, f"Invalid {label} port", None
        return True, cleaned_value, parsed_value

    valid, cleaned, parsed = validate(url, "URL")
    if not valid:
        return False, "error", cleaned, None

    cleaned_referer = None
    if referer is not None:
        if not isinstance(referer, str) or any(c in referer for c in "\x00\n\r"):
            return False, "error", "Invalid Referer: Invalid Referer input", None
        if referer.strip():
            valid, cleaned_referer, _ = validate(referer, "Referer")
            if not valid:
                return False, "error", f"Invalid Referer: {cleaned_referer}", None

    mode = "direct" if is_direct or os.path.splitext(parsed.path)[1].lower() in _MEDIA_EXTENSIONS else "ytdlp"
    return True, mode, cleaned, cleaned_referer
