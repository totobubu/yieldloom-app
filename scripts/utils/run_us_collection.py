"""One entry point for dividend verification, registration and enrichment."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def commands(workers: int, resume: bool) -> list[list[str]]:
    discovery = [sys.executable, str(ROOT / "scripts/utils/discover_us_dividend_stocks.py"),
                 "--verify-limit", "-1", "--workers", str(workers)]
    if resume:
        discovery.extend(["--resume", "--refresh-etfs"])
    else:
        discovery.append("--all-us")
    return [discovery,
            [sys.executable, str(ROOT / "scripts/utils/export_us_dividend_catalog.py")],
            [sys.executable, str(ROOT / "scripts/utils/collect_security_insights.py"),
             "--resume", "--workers", str(workers)],
            [sys.executable, str(ROOT / "scripts/utils/export_security_insights.py")]]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="미국 배당주 검증·등록·ROC 및 유용한 정보 통합 수집")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    if not 1 <= args.workers <= 8:
        parser.error("workers must be 1~8")
    partial = False
    for command in commands(args.workers, args.resume):
        print("Running: " + Path(command[1]).name, flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)
        if result.returncode == 2:
            partial = True
        elif result.returncode:
            return result.returncode
    return 2 if partial else 0


if __name__ == "__main__":
    raise SystemExit(main())
