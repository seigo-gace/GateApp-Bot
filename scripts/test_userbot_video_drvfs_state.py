import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import userbot_public_video_archive as module


class ArchiveGDriveStateTests(unittest.TestCase):
    def test_drvfs_chmod_denied_preserves_atomic_progress(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "public_channel_videos" / "_jobs"
            root.mkdir(parents=True)
            destination = root / "example.json"
            with patch.object(module, "STORAGE", Path(temp)), \
                 patch.object(module, "STATE_ROOT", root), \
                 patch.object(module.os, "chmod", side_effect=PermissionError("DrvFS chmod not supported")):
                module.write_state(destination, {"status": "running", "discovered": 12})
                self.assertIn('"discovered": 12', destination.read_text(encoding="utf-8"))

    def test_forbidden_state_parent_never_written(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "_jobs"
            other = Path(temp) / "other"
            root.mkdir()
            other.mkdir()
            with patch.object(module, "STORAGE", Path("/mnt/g/GserverStorage")), \
                 patch.object(module, "STATE_ROOT", root):
                with self.assertRaisesRegex(RuntimeError, "ARCHIVE_STATE_PATH_INVALID"):
                    module.write_state(other / "wrong.json", {"status": "running"})


if __name__ == "__main__":
    unittest.main()
