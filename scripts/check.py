"""One reproducible local/CI check command; no network calls or hardware access."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def main():
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        raise SystemExit("Run bootstrap.py first.")
    node = shutil.which("node")
    if not node:
        raise SystemExit("Install Node.js 24 or newer to run the JavaScript checks.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if int(version.lstrip("v").split(".")[0]) < 24:
        raise SystemExit("Use Node.js 24 or newer for these checks.")
    for path in [ROOT / "package.json", *(ROOT / ".vscode").glob("*.json")]:
        json.loads(path.read_text(encoding="utf-8"))
    tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    for directory in ["app", "tests", "scripts"]:
        for path in (ROOT / directory).rglob("*.py"):
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
    for path in [ROOT / "bootstrap.py", ROOT / "run.py"]:
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
    subprocess.run([str(python), "-m", "pytest", "-q"], cwd=ROOT, check=True)
    modules = [*(ROOT / "app/static").rglob("*.mjs"), *(ROOT / "scripts").glob("*.mjs")]
    for path in sorted(modules):
        subprocess.run([node, "--check", str(path)], cwd=ROOT, check=True)
    tests = sorted(str(path) for path in (ROOT / "tests").glob("*.test.mjs"))
    subprocess.run([node, "--test", *tests], cwd=ROOT, check=True)
    print("All local checks passed. Browser and real-device checks remain separate.")


if __name__ == "__main__":
    main()
