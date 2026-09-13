import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == "nt", "Windows-only uninstaller")
class UninstallerTests(unittest.TestCase):
    def test_complete_uninstall_removes_only_the_marked_installation(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="lootsniper uninstall test ") as parent:
            install = Path(parent) / "LootSniper"
            install.mkdir()
            (install / "server.py").write_text("test", encoding="utf-8")
            for name in ("Disinstalla LootSniper.cmd", "disinstalla.ps1"):
                shutil.copyfile(root / name, install / name)
            (install / "distribuzione.json").write_text(json.dumps({"version": "test"}), encoding="utf-8")
            private = install / "radar-discord.json"
            private.write_text("PRIVATE", encoding="utf-8")
            result = subprocess.run([
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(install / "disinstalla.ps1"),
                "-InstallDir", str(install), "-Yes", "-NoShortcuts"
            ], cwd=Path(parent), capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertFalse(install.exists())
            self.assertTrue(Path(parent).exists())


if __name__ == "__main__":
    unittest.main()
