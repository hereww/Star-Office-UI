"""Local process readiness only; never query Sub2API or log sensitive data."""
import os
import sys
import urllib.request


def main():
    if sys.argv[1:] == ['collector']:
        from backend.office_collector import collector_health
        return 0 if collector_health(os.environ.get('OFFICE_DATA_DIR', '/data/office')) else 1
    if sys.argv[1:] == ['web']:
        try:
            with urllib.request.urlopen('http://127.0.0.1:19000/health', timeout=3) as response:
                return 0 if response.status == 200 else 1
        except Exception:
            return 1
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
