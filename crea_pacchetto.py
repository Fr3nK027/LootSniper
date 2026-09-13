"""Package the local application for GitHub, excluding personal archives and logs."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
FILES = [
    '.gitignore', 'README.md', 'Installa LootSniper.cmd', 'installa.ps1', 'Disinstalla LootSniper.cmd', 'disinstalla.ps1', 'distribuzione.json',
    'radar-guide.js', 'theme.js', 'experience.css', 'assets/lootsniper.svg', 'assets/lootsniper.ico', 'avvia radar locale.bat', 'launcher.py', 'server.py',
    'avvia radar.vbs', 'radar_discord.py', 'radar_lifecycle.py', 'radar-runtime.js',
    'radar usato 3 market.html', 'app.js', 'styles.css', 'radar-core.js', 'crea_pacchetto.py',
    'browser-bridge/README.md', 'browser-bridge/manifest.json', 'browser-bridge/background.js',
    'browser-bridge/content.js', 'browser-bridge/listings.js', 'browser-bridge/popup.html', 'browser-bridge/popup.js',
    'docs/images/avvio.svg', 'docs/images/estensione.svg', 'docs/images/dashboard.png', 'docs/images/dashboard-notte.png', 'docs/images/confronto.png', 'docs/images/discord.png', 'docs/images/guida.png',
    'tests/test_server.py', 'tests/test_launcher.py', 'tests/core.test.js', 'tests/app.test.js',
    'tests/extension.test.js', 'tests/theme.test.js', 'tests/preview_server.py', 'tests/listings.html', 'tests/test_distribution.py', 'tests/test_runtime.py', 'tests/test_hidden_start.py', 'tests/test_uninstaller.py'
]

def main():
    manifest = json.loads((ROOT / 'distribuzione.json').read_text(encoding='utf-8'))
    if manifest.get('files') != FILES:
        raise RuntimeError('Aggiorna distribuzione.json: elenco diverso dal pacchetto')
    for name in FILES:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(name)
    output = ROOT / 'dist'
    if output.is_symlink() or output.resolve() != ROOT / 'dist':
        raise RuntimeError('Cartella di destinazione non sicura')
    output.mkdir(exist_ok=True)
    archive_path = output / 'LootSniper-Windows.zip'
    with ZipFile(archive_path, 'w', ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(ROOT / name, name)
    with ZipFile(archive_path) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(FILES):
            raise RuntimeError('Verifica del pacchetto fallita')
    print('Pacchetto pronto: ' + str(archive_path))
    print('Inclusi codice, estensione, guida e immagini. Esclusi archivi personali, cache e log.')
    return archive_path

if __name__ == '__main__':
    main()
