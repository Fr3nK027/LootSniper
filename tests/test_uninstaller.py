import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == "nt", "Windows-only uninstaller")
class UninstallerTests(unittest.TestCase):
    def make_install(self, parent, include_uninstaller):
        root = Path(__file__).resolve().parents[1]
        install = Path(parent) / "LootSniper"
        install.mkdir()
        for name in ("server.py", "launcher.py", "radar usato 3 market.html"):
            (install / name).write_text("test", encoding="utf-8")
        (install / "distribuzione.json").write_text(json.dumps({"version": "test"}), encoding="utf-8")
        (install / "radar-discord.json").write_text("PRIVATE", encoding="utf-8")
        if include_uninstaller:
            for name in ("Disinstalla LootSniper.cmd", "disinstalla.ps1"):
                shutil.copyfile(root / name, install / name)
        return install

    def run_uninstaller(self, script, install, parent):
        return subprocess.run([
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script),
            "-InstallDir", str(install), "-Yes", "-NoShortcuts"
        ], cwd=Path(parent), capture_output=True, text=True, timeout=30)

    def test_complete_uninstall_removes_only_the_marked_installation(self):
        with tempfile.TemporaryDirectory(prefix="lootsniper uninstall test ") as parent:
            install = self.make_install(parent, include_uninstaller=True)
            result = self.run_uninstaller(install / "disinstalla.ps1", install, parent)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertFalse(install.exists())
            self.assertTrue(Path(parent).exists())

    def test_downloaded_uninstaller_removes_an_older_installation(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="lootsniper legacy uninstall test ") as parent:
            install = self.make_install(parent, include_uninstaller=False)
            result = self.run_uninstaller(root / "disinstalla.ps1", install, parent)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertFalse(install.exists())


if __name__ == "__main__":
    unittest.main()
