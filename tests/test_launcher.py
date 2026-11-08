import unittest
from unittest.mock import patch, MagicMock
from host.vlc_launcher import launch_vlc

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
        self.assertEqual(cmd, ["/usr/bin/vlc", "--", "https://example.com/test.mp4"])
        self.assertTrue(kwargs.get("start_new_session"))

    @patch("shutil.which", return_value=None)
    def test_launch_vlc_binary_missing(self, mock_which):
        ok, err = launch_vlc("https://example.com/test.mp4")
        self.assertFalse(ok)
        self.assertIn("not found", err.lower())

if __name__ == "__main__":
    unittest.main()
