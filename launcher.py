"""Start LootSniper only when its local server is ready; keep logs in the project."""
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
import json
import subprocess
import sys
import time
import webbrowser
import argparse
from server import WORKSPACE_ID, VERSION

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:8765"


def server_status():
    try:
        with urlopen(URL + "/api/status", timeout=1) as response:
            payload = json.load(response)
        return payload if isinstance(payload, dict) and payload.get("online") else {"conflict": True}
    except HTTPError as error:
        error.close()
        return {"conflict": True}
    except URLError:
        return None
    except (ValueError, OSError):
        return {"conflict": True}


def main(background=False):
    existing = server_status()
    if existing:
        if existing.get("version") != VERSION or existing.get("workspace") != WORKSPACE_ID:
            print("La porta 8765 è occupata da un'altra copia di LootSniper o da una versione precedente.")
            print("Chiudi il vecchio server e riprova.")
            return 1
        webbrowser.open(URL)
        print("Dashboard aperta. Il server era già attivo.")
        return 0
    with (ROOT / "radar-server.log").open("a", encoding="utf-8") as log:
        command = [sys.executable, "-u", str(ROOT / "server.py")]
        if background:
            command.append('--auto-stop')
        process = subprocess.Popen(command, cwd=ROOT,
                                   stdout=log, stderr=log,
                                   stdin=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), close_fds=True)
        detached = False
        try:
            for _ in range(40):
                if process.poll() is not None:
                    print("Il server non si è avviato. Dettagli in radar-server.log.")
                    return 1
                current = server_status()
                if current and current.get("version") == VERSION and current.get("workspace") == WORKSPACE_ID:
                    break
                time.sleep(.2)
            else:
                print("Il server non risponde. Dettagli in radar-server.log.")
                return 1
            webbrowser.open(URL)
            print("LootSniper pronto: " + URL)
            if background:
                detached = True
                return 0
            print("Lascia questa finestra aperta. Premi Ctrl+C per arrestare il server.")
            process.wait()
            return process.returncode
        except KeyboardInterrupt:
            print("Arresto di LootSniper…")
            return 0
        finally:
            if not detached and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--background', action='store_true')
    raise SystemExit(main(parser.parse_args().background))
