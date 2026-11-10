import subprocess
import unittest
from unittest.mock import patch, MagicMock
from host.vlc_launcher import launch_vlc, find_ytdlp_binary

class TestLauncher(unittest.TestCase):
    @patch("shutil.which", return_value="/usr/bin/vlc")
    @patch("subprocess.Popen")
    def test_launch_vlc_success(self, mock_popen, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_popen.return_value = mock_proc

        ok, msg = launch_vlc("https://example.com/test.mp4")
        self.assertTrue(ok)
        self.assertIn("9999", msg)

        mock_which.assert_called_once_with("vlc")
        mock_popen.assert_called_once()
        args, kwargs = mock_popen.call_args
        cmd = args[0]
        self.assertEqual(cmd, ["/usr/bin/vlc", "--one-instance", "--", "https://example.com/test.mp4"])
        self.assertTrue(kwargs.get("start_new_session"))

    @patch("shutil.which", return_value=None)
    def test_launch_vlc_binary_missing(self, mock_which):
        ok, err = launch_vlc("https://example.com/test.mp4")
        self.assertFalse(ok)
        self.assertIn("not found", err.lower())

    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    @patch("subprocess.Popen")
    def test_launch_vlc_with_referer(self, mock_popen, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 8888
        mock_popen.return_value = mock_proc

        ok, msg = launch_vlc("https://cdn.example.com/video.mp4", referer="https://anime.example.com/")
        self.assertTrue(ok)
        args, kwargs = mock_popen.call_args
        cmd = args[0]
        self.assertEqual(cmd, ["/usr/bin/vlc", "--one-instance", "--http-referrer", "https://anime.example.com/", "--", "https://cdn.example.com/video.mp4"])

    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    @patch("subprocess.run")
    @patch("subprocess.Popen")
    def test_direct_mode_bypasses_ytdlp(self, mock_popen, mock_run, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_popen.return_value = mock_proc

        ok, msg = launch_vlc("https://cdn.example.com/stream.m3u8", mode="direct")
        self.assertTrue(ok)
        mock_run.assert_not_called()

    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    @patch("subprocess.run")
    @patch("subprocess.Popen")
    def test_launch_vlc_via_ytdlp_resolver_success(self, mock_popen, mock_run, mock_which):
        mock_ytdlp = MagicMock()
        mock_ytdlp.returncode = 0
        mock_ytdlp.stdout = "https://resolved.cdn.com/stream.m3u8\n"
        mock_run.return_value = mock_ytdlp

        mock_proc = MagicMock()
        mock_proc.pid = 7777
        mock_popen.return_value = mock_proc

        ok, msg = launch_vlc("https://example.com/watch/video", referer="https://page.com", mode="ytdlp")
        self.assertTrue(ok)
        mock_run.assert_called_once()
        run_cmd = mock_run.call_args[0][0]
        self.assertIn("--get-url", run_cmd)
        self.assertIn("-f", run_cmd)
        self.assertIn("b/best", run_cmd)
        self.assertIn("--referer", run_cmd)
        self.assertIn("https://page.com", run_cmd)
        vlc_cmd = mock_popen.call_args[0][0]
        self.assertEqual(vlc_cmd, ["/usr/bin/vlc", "--one-instance", "--http-referrer", "https://page.com", "--", "https://resolved.cdn.com/stream.m3u8"])

    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    @patch("subprocess.Popen")
    def test_launch_vlc_enqueue_flag(self, mock_popen, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_popen.return_value = mock_proc

        ok, msg = launch_vlc("https://example.com/test.mp4", enqueue=True)
        self.assertTrue(ok)
        args, _ = mock_popen.call_args
        cmd = args[0]
        self.assertEqual(cmd, ["/usr/bin/vlc", "--one-instance", "--playlist-enqueue", "--", "https://example.com/test.mp4"])

    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    @patch("subprocess.Popen")
    def test_launch_vlc_enqueue_false_omits_playlist_enqueue(self, mock_popen, mock_which):
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_popen.return_value = mock_proc

        ok, msg = launch_vlc("https://example.com/test.mp4", enqueue=False)
        self.assertTrue(ok)
        args, _ = mock_popen.call_args
        cmd = args[0]
        self.assertEqual(cmd, ["/usr/bin/vlc", "--one-instance", "--", "https://example.com/test.mp4"])

    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    @patch("subprocess.run")
    @patch("subprocess.Popen")
    def test_ytdlp_dangerous_output_rejected(self, mock_popen, mock_run, mock_which):
        mock_ytdlp = MagicMock()
        mock_ytdlp.returncode = 0
        mock_ytdlp.stdout = "file:///etc/passwd\n"
        mock_run.return_value = mock_ytdlp

        ok, err = launch_vlc("https://example.com/watch/video", mode="ytdlp")
        self.assertFalse(ok)
        self.assertIn("rejected", err.lower())
        mock_popen.assert_not_called()

    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="yt-dlp", timeout=15))
    def test_ytdlp_timeout_handled(self, mock_run, mock_which):
        ok, err = launch_vlc("https://example.com/watch/slow", mode="ytdlp")
        self.assertFalse(ok)
        self.assertIn("timed out", err.lower())

    @patch("host.vlc_launcher.find_ytdlp_binary", return_value=None)
    @patch("shutil.which", side_effect=lambda x: f"/usr/bin/{x}")
    def test_ytdlp_missing_handled(self, mock_which, mock_find):
        ok, err = launch_vlc("https://example.com/watch/video", mode="ytdlp")
        self.assertFalse(ok)
        self.assertIn("yt-dlp is required", err)

if __name__ == "__main__":
    unittest.main()
