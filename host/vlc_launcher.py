import os
import shutil
import subprocess

try:
    from host.validator import validate_request
except ImportError:
    from validator import validate_request


def find_ytdlp_binary(custom_bin: str = "yt-dlp") -> str | None:
    resolved = shutil.which(custom_bin)
    if resolved:
        return resolved
    for candidate in ("/usr/sbin/yt-dlp", "/usr/bin/yt-dlp", "/usr/local/bin/yt-dlp"):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def launch_vlc(
    url: str,
    referer: str | None = None,
    mode: str = "direct",
    enqueue: bool = False,
    vlc_bin: str = "vlc",
    ytdlp_bin: str = "yt-dlp",
) -> tuple[bool, str]:
    resolved_vlc = shutil.which(vlc_bin)
    if not resolved_vlc:
        return False, f"VLC binary '{vlc_bin}' not found in PATH."
    try:
        target_url = url
        if mode == "ytdlp":
            resolved_ytdlp = find_ytdlp_binary(ytdlp_bin)
            if resolved_ytdlp is None:
                return False, "yt-dlp is required to resolve this link but was not found in PATH or standard system paths."
            ytdlp_cmd = [resolved_ytdlp, "-f", "b/best", "--get-url", "--no-warnings"]
            if referer:
                ytdlp_cmd.extend(["--referer", referer])
            ytdlp_cmd.extend(["--", url])
            try:
                res = subprocess.run(ytdlp_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15, check=False)
            except subprocess.TimeoutExpired:
                return False, "yt-dlp resolution timed out after 15 seconds."
            if res.returncode != 0 or not res.stdout.strip():
                return False, f"yt-dlp extraction failed: {res.stderr.strip() or 'no stream URL extracted'}"
            extracted = res.stdout.strip().splitlines()[0].strip()
            is_valid, _, clean_extracted, _ = validate_request(extracted, is_direct=True)
            if not is_valid:
                return False, f"Extracted stream URL rejected by security policy: {clean_extracted}"
            target_url = clean_extracted
        vlc_cmd = [resolved_vlc, "--one-instance"]
        if enqueue:
            vlc_cmd.append("--playlist-enqueue")
        if referer:
            vlc_cmd.extend(["--http-referrer", referer])
        vlc_cmd.extend(["--", target_url])
        proc = subprocess.Popen(vlc_cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return True, f"VLC started (pid: {proc.pid})"
    except Exception as e:
        return False, f"Failed to execute VLC: {e}"
