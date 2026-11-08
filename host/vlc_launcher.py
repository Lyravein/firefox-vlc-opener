import shutil
import subprocess


def launch_vlc(url: str, vlc_bin: str = "vlc") -> tuple[bool, str]:
    resolved_bin = shutil.which(vlc_bin)
    if not resolved_bin:
        return False, f"VLC binary '{vlc_bin}' not found in PATH."
    try:
        proc = subprocess.Popen(
            [resolved_bin, "--", url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True, f"VLC started (pid: {proc.pid})"
    except Exception as e:
        return False, f"Failed to execute VLC: {e}"
