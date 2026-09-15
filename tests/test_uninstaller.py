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

    def run_uninstaller(self, script, install, parent, no_shortcuts=True, shortcut_roots=None):
        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script),
            "-InstallDir", str(install), "-Yes", "-BrowserDataDir", str(Path(parent) / "BrowserData")
        ]
        if no_shortcuts:
            command.append("-NoShortcuts")
        if shortcut_roots:
            command.extend(["-ShortcutRoots", *map(str, shortcut_roots)])
        return subprocess.run(command, cwd=Path(parent), capture_output=True, text=True, timeout=30)

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

    def test_uninstaller_closes_processes_started_from_the_installation(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="lootsniper running uninstall test ") as parent:
            install = self.make_install(parent, include_uninstaller=False)
            sleeper = install / "python.exe"
            shutil.copyfile(Path(os.environ["WINDIR"]) / "System32" / "ping.exe", sleeper)
            process = subprocess.Popen(
                [str(sleeper), "-n", "60", "127.0.0.1"],
                cwd=install, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            try:
                result = self.run_uninstaller(root / "disinstalla.ps1", install, parent)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                process.wait(timeout=5)
                self.assertFalse(install.exists())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()

    def test_uninstaller_removes_desktop_and_start_shortcuts_from_supplied_roots(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="lootsniper shortcut uninstall test ") as parent:
            install = self.make_install(parent, include_uninstaller=False)
            one_drive_desktop = Path(parent) / "OneDrive" / "Desktop"
            one_drive_desktop.mkdir(parents=True)
            shortcuts = [one_drive_desktop / "LootSniper.lnk", one_drive_desktop / "Disinstalla LootSniper.lnk"]
            for shortcut in shortcuts:
                shortcut.write_text("stale shortcut", encoding="utf-8")
            result = self.run_uninstaller(root / "disinstalla.ps1", install, parent,
                                          no_shortcuts=False, shortcut_roots=[one_drive_desktop])
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(all(not shortcut.exists() for shortcut in shortcuts))
            self.assertFalse(install.exists())


if __name__ == "__main__":
    unittest.main()
