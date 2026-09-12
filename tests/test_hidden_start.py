import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

@unittest.skipUnless(os.name == 'nt', 'Windows-only hidden launcher')
class HiddenStartTests(unittest.TestCase):
    def test_vbs_and_bat_forward_background_flag_with_spaces_in_path(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='radar hidden test ') as directory:
            folder = Path(directory)
            for name in ['avvia radar.vbs', 'avvia radar locale.bat']:
                shutil.copyfile(root / name, folder / name)
            (folder / 'launcher.py').write_text(
                "import json, sys\nfrom pathlib import Path\nPath('observed.json').write_text(json.dumps(sys.argv[1:]))\n",
                encoding='utf-8')
            result = subprocess.run(['cscript.exe', '//B', '//Nologo', str(folder / 'avvia radar.vbs')],
                                    cwd=folder, capture_output=True, timeout=30,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((folder / 'observed.json').exists(), 'The hidden launcher did not start Python')
            self.assertEqual(json.loads((folder / 'observed.json').read_text()), ['--background'])
