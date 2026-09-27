"""
Utility script to run the local onboarding workflow for new tickers.

Example:
    python scripts/run_new_ticker_workflow.py WEED MAGS

Features:
    1. Executes npm/node and Python steps in order.
    2. Stops on the first failure with clear logs.
    3. Uses the Windows formatting script automatically when needed.
    4. Offers a --dry-run option to preview the plan.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable


def resolve_executable(executable: str) -> str:
    """Return a platform-appropriate executable path."""
    system = platform.system().lower()
    if system.startswith("win"):
        if executable.lower() in {"npm", "npx"}:
            return f"{executable}.cmd"
        if not os.path.splitext(executable)[1]:
            # PATHEXT를 이용해 직접 찾는다.
            path = shutil.which(executable)
            if path:
                return path
    return executable


def run_command(label: str, command: List[str], dry_run: bool = False) -> None:
    """Run a command and raise if it fails."""
    if not command:
        raise ValueError("Command is empty.")

    normalized = [resolve_executable(command[0]), *command[1:]]
    printable = shlex.join(normalized)
    print(f"\n-> {label}\n   $ {printable}")

    if dry_run:
        return

    result = subprocess.run(normalized, cwd=PROJECT_ROOT)
    if result.returncode != 0:
        raise RuntimeError(
            f"Step failed ({label}) - exit code {result.returncode}\n"
            f"Command: {printable}"
        )


def get_ticker_markets(tickers: Iterable[str]) -> dict[str, list[str]]:
    """Load nav.json and group tickers by market (KR/US)."""
    nav_path = PROJECT_ROOT / "public" / "nav.json"
    if not nav_path.exists():
        # nav.json이 없으면 모든 티커를 US로 간주 (fallback)
        return {"KR": [], "US": list(tickers)}

    with open(nav_path, "r", encoding="utf-8") as f:
        nav_data = json.load(f)

    ticker_map = {t["symbol"].upper(): t for t in nav_data.get("nav", [])}

    kr_tickers = []
    us_tickers = []

    for ticker in tickers:
        ticker_upper = ticker.upper()
        ticker_info = ticker_map.get(ticker_upper)

        if not ticker_info:
            # nav.json에 없으면 currency로 판단
            us_tickers.append(ticker_upper)
            continue

        market = ticker_info.get("market", "").upper()
        currency = ticker_info.get("currency", "").upper()

        if market in ("KOSPI", "KOSDAQ", "KONEX") or currency == "KRW":
            kr_tickers.append(ticker_upper)
        else:
            us_tickers.append(ticker_upper)

    return {"KR": kr_tickers, "US": us_tickers}


def prepare_steps(tickers: Iterable[str], skip_format: bool):
    """Return the ordered list of workflow steps."""
    ticker_args = [t.upper() for t in tickers]
    if not ticker_args:
        raise ValueError("Specify at least one ticker.")

    format_script = (
        ["npm", "run", "format:changed:win"]
        if platform.system().lower().startswith("win")
        else ["npm", "run", "format:changed"]
    )

    steps = [
        ("Update IPO dates (nav)", ["npm", "run", "add-ipo-dates"]),
        (
            "Analyze dividend frequency",
            [PYTHON, "scripts/data_pipeline/analyze_dividend_frequency.py", *ticker_args],
        ),
        ("Regenerate nav", ["npm", "run", "generate-nav"]),
        (
            "Scrape info data",
            [PYTHON, "scripts/data_pipeline/scraper_info.py", *ticker_args],
        ),
    ]

    # 티커를 market별로 분류하여 적절한 스크립트 실행
    ticker_markets = get_ticker_markets(ticker_args)
    os.environ["DATA_LAYOUT_MODE"] = "market"

    if ticker_markets["KR"]:
        steps.append(
            (
                f"Update historical prices (KR: {', '.join(ticker_markets['KR'])})",
                ["node", "tasks/updateHistoricalKrData.js", *ticker_markets["KR"]],
            )
        )

    if ticker_markets["US"]:
        steps.append(
            (
                f"Update historical prices (US: {', '.join(ticker_markets['US'])})",
                ["node", "tasks/updateHistoricalUsData.js", *ticker_markets["US"]],
            )
        )

    steps.extend(
        [
            (
                "Update market cap",
                [PYTHON, "scripts/data_pipeline/update_market_cap.py", *ticker_args],
            ),
            (
                "Update dividend history",
                [PYTHON, "scripts/data_pipeline/update_dividends.py", *ticker_args],
            ),
            (
                "Scrape dividends",
                [PYTHON, "scripts/data_pipeline/scraper_dividend.py", *ticker_args],
            ),
            (
                "Project future dividends",
                [PYTHON, "scripts/data_pipeline/project_future_dividends.py", *ticker_args],
            ),
            (
                "Regenerate calendar events",
                ["npm", "run", "generate-calendar-events"],
            ),
            (
                "Regenerate sidebar tickers",
                [PYTHON, "scripts/generate_sidebar_tickers.py"],
            ),
        ]
    )

    if not skip_format:
        steps.append(("Format changed files", format_script))

    return steps


def main():
    parser = argparse.ArgumentParser(
        description="Run the local onboarding workflow for new tickers."
    )
    parser.add_argument(
        "tickers",
        nargs="+",
        help="Ticker symbols to process.",
    )
    parser.add_argument(
        "--skip-format",
        action="store_true",
        help="Skip the final formatting step.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the plan without executing commands.",
    )

    args = parser.parse_args()

    os.chdir(PROJECT_ROOT)

    steps = prepare_steps(
        args.tickers,
        skip_format=args.skip_format,
    )

    print("=" * 80)
    print("Local new-ticker workflow")
    print(f"Tickers: {', '.join(t.upper() for t in args.tickers)}")
    print(f"Total steps: {len(steps)}")
    print(f"Project root: {PROJECT_ROOT}")
    print("=" * 80)

    for index, (label, command) in enumerate(steps, start=1):
        print(f"\n=== Step {index}/{len(steps)} ===")
        run_command(label, command, dry_run=args.dry_run)

    if args.dry_run:
        print("\n[DRY-RUN] No commands were executed.")
    else:
        print("\n[OK] All steps completed successfully.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAborted by user (Ctrl+C).")
        sys.exit(1)
    except Exception as exc:  # pylint: disable=broad-except
        print(f"\n[ERROR] Workflow aborted due to error: {exc}")
        sys.exit(1)
