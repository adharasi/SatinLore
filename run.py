"""Local loopback only. For deployment, complete docs/beta-roadmap.md first."""
from pathlib import Path
import os
import subprocess

def main():
    root = Path(__file__).resolve().parent
    python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        raise SystemExit("Run bootstrap.py first.")
    subprocess.run(
        [str(python), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"],
        cwd=root, check=True,
    )


if __name__ == "__main__":
    main()
