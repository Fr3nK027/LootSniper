import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
import crea_pacchetto

class DistributionTests(unittest.TestCase):
    def test_package_excludes_personal_data_and_includes_readme_images(self):
        source = crea_pacchetto.ROOT
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in crea_pacchetto.FILES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source / name, target)
            for name in ['radar-searches.json', 'radar-imports.json', 'radar-server.log', 'radar-discord.json']:
                (root / name).write_text('PRIVATE', encoding='utf-8')
            with patch.object(crea_pacchetto, 'ROOT', root):
                archive_path = crea_pacchetto.main()
            with ZipFile(archive_path) as archive:
                self.assertEqual(set(archive.namelist()), set(crea_pacchetto.FILES))
                self.assertNotIn('radar-searches.json', archive.namelist())
                self.assertNotIn('radar-imports.json', archive.namelist())
                self.assertNotIn('radar-server.log', archive.namelist())
                self.assertNotIn('radar-discord.json', archive.namelist())
                readme = archive.read('README.md').decode('utf-8')
                images = re.findall(r'!\[[^\]]*\]\(([^)]+)\)', readme)
                self.assertEqual(len(images), 5)
                for name in images:
                    self.assertIn(name, archive.namelist())
                    self.assertGreater(len(archive.read(name)), 100)
