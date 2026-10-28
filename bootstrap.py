"""Create an isolated development environment without changing system packages."""
from pathlib import Path
import os
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


def main():
    if sys.version_info < (3, 12):
        raise SystemExit("Install Python 3.12 or newer first.")
    target = ROOT / ".venv"
    python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        venv.create(target, with_pip=True)
    subprocess.run(
        [str(python), "-m", "pip", "install", "-r", "requirements-dev.txt"],
        cwd=ROOT, check=True,
    )
    print("Ready. Run py run.py (Windows) or python3 run.py (macOS/Linux).")


if __name__ == "__main__":
    main()
