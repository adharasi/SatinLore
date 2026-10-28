"""Issue one expiring beta invitation locally. The token is shown once."""
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.config import load_settings
from app.db.store import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=24, help="Lifetime, 1 to 168 hours (default: 24)")
    args = parser.parse_args()
    if not 1 <= args.hours <= 168:
        parser.error("--hours must be between 1 and 168")
    settings = load_settings()
    token = Store(settings.database_path).create_invite(args.hours * 3600)
    print(token)


if __name__ == "__main__":
    main()
