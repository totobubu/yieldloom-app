#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
배당 amount 오류 수정 스크립트

이 스크립트는 analyze_dividend_errors.py로 검출된 오류를 수정합니다.

실행 방법:
    # Level 1 오류만 수정 (가장 안전)
    python scripts/data_pipeline/fix_dividend_errors.py --level1

    # 특정 심볼만 수정
    python scripts/data_pipeline/fix_dividend_errors.py --level1 --symbols AMDU,MST

    # Dry-run (실제 수정하지 않고 확인만)
    python scripts/data_pipeline/fix_dividend_errors.py --level1 --dry-run
"""

import os
import json
import sys
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List
import shutil

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
REPORT_DIR = ROOT_DIR / "scripts" / "data_pipeline"
BACKUP_DIR = ROOT_DIR / "backups" / "dividend_fixes"


class DividendErrorFixer:
    def __init__(self, dry_run: bool = False, symbols: List[str] = None):
        self.dry_run = dry_run
        self.target_symbols = set(symbols) if symbols else None
        self.fixes_applied = []
        self.backup_created = False

    def create_backup(self, file_path: str) -> None:
        """파일 백업 생성"""
        if self.dry_run:
            return

        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = BACKUP_DIR / f"{Path(file_path).stem}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        shutil.copy2(file_path, backup_path)

    def fix_level1_errors(self) -> int:
        """Level 1 오류 수정: amountFixed 기준으로 amount 수정"""
        # 상세 오류 데이터 로드
        error_file = REPORT_DIR / "dividend_errors_detail.json"
        if not error_file.exists():
            print("❌ 오류 데이터 파일이 없습니다. 먼저 analyze_dividend_errors.py를 실행하세요.")
            return 0

        with open(error_file, 'r', encoding='utf-8') as f:
            error_data = json.load(f)

        level1_errors = error_data['errors']['level1_fixed_mismatch']

        if not level1_errors:
            print("✅ Level 1 오류가 없습니다.")
            return 0

        print(f"\n🔧 Level 1 오류 수정 시작 ({len(level1_errors)}건)")
        if self.dry_run:
            print("📋 DRY-RUN 모드: 실제 파일은 수정되지 않습니다.\n")

        # 파일별로 그룹화
        files_to_fix = {}
        for error in level1_errors:
            symbol = error['symbol']

            # 특정 심볼만 수정하는 경우
            if self.target_symbols and symbol not in self.target_symbols:
                continue

            file_path = error['file']
            if file_path not in files_to_fix:
                files_to_fix[file_path] = []
            files_to_fix[file_path].append(error)

        fixed_count = 0
        for file_path, errors in files_to_fix.items():
            try:
                # 파일 로드
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                backtest_data = data.get('backtestData', [])
                symbol = errors[0]['symbol']

                print(f"\n📁 {symbol} ({len(errors)}건 수정)")

                # 백업 생성
                if not self.dry_run:
                    self.create_backup(file_path)

                # 각 오류 항목 수정
                for error in errors:
                    date = error['date']
                    old_amount = error['amount']
                    new_amount = error['amountFixed']

                    # 해당 날짜의 데이터 찾아서 수정
                    for item in backtest_data:
                        if item.get('date') == date:
                            # amountOriginal이 없으면 기존 amount를 백업
                            if 'amountOriginal' not in item and 'amount' in item:
                                item['amountOriginal'] = item['amount']

                            # amount를 amountFixed로 수정
                            item['amount'] = new_amount

                            print(f"  ✓ {date}: {old_amount} → {new_amount}")

                            self.fixes_applied.append({
                                "symbol": symbol,
                                "file": file_path,
                                "date": date,
                                "old_amount": old_amount,
                                "new_amount": new_amount,
                                "level": 1
                            })
                            fixed_count += 1
                            break

                # 파일 저장
                if not self.dry_run:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=4, ensure_ascii=False)

            except Exception as e:
                print(f"  ❌ 오류 발생: {e}")

        return fixed_count

    def generate_fix_report(self) -> str:
        """수정 리포트 생성"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        report = f"""# 배당 Amount 수정 리포트

**실행 일시**: {timestamp}
**모드**: {"DRY-RUN (시뮬레이션)" if self.dry_run else "실제 수정"}

## 📊 수정 요약

- **총 수정 건수**: {len(self.fixes_applied)}건

"""

        if self.fixes_applied:
            # 심볼별로 그룹화
            by_symbol = {}
            for fix in self.fixes_applied:
                symbol = fix['symbol']
                if symbol not in by_symbol:
                    by_symbol[symbol] = []
                by_symbol[symbol].append(fix)

            report += "### 심볼별 수정 내역\n\n"
            for symbol, fixes in sorted(by_symbol.items()):
                report += f"#### {symbol} ({len(fixes)}건)\n\n"
                report += "| Date | Old Amount | New Amount | Level |\n"
                report += "|------|------------|------------|-------|\n"

                for fix in sorted(fixes, key=lambda x: x['date']):
                    report += f"| {fix['date']} | {fix['old_amount']} | {fix['new_amount']} | {fix['level']} |\n"

                report += "\n"

        else:
            report += "수정된 항목이 없습니다.\n\n"

        report += """
## 💾 백업 정보

"""
        if not self.dry_run:
            report += f"백업 위치: `{BACKUP_DIR}`\n\n"
            report += "수정 전 파일은 백업되었습니다. 문제가 있을 경우 백업에서 복원할 수 있습니다.\n"
        else:
            report += "DRY-RUN 모드이므로 실제 수정이나 백업이 수행되지 않았습니다.\n"

        report += """

## 🔄 복원 방법

문제가 발생한 경우 백업에서 복원:
```bash
# 백업 파일 확인
ls backups/dividend_fixes/

# 특정 파일 복원
cp backups/dividend_fixes/[심볼]_[타임스탬프].json public/data/[market]/[심볼].json
```

---

*본 리포트는 자동으로 생성되었습니다.*
"""

        return report


def main():
    parser = argparse.ArgumentParser(description='배당 amount 오류 수정')
    parser.add_argument('--level1', action='store_true', help='Level 1 오류 수정 (amountFixed 기준)')
    parser.add_argument('--dry-run', action='store_true', help='실제 수정하지 않고 시뮬레이션만')
    parser.add_argument('--symbols', type=str, help='수정할 심볼 (쉼표로 구분, 예: AMDU,MST)')

    args = parser.parse_args()

    if not args.level1:
        print("수정할 레벨을 지정하세요: --level1")
        return

    symbols = args.symbols.split(',') if args.symbols else None
    if symbols:
        symbols = [s.strip().upper() for s in symbols]

    fixer = DividendErrorFixer(dry_run=args.dry_run, symbols=symbols)

    if args.level1:
        fixed_count = fixer.fix_level1_errors()
        print(f"\n✅ Level 1 수정 완료: {fixed_count}건")

    # 리포트 생성
    report = fixer.generate_fix_report()

    suffix = "_dryrun" if args.dry_run else ""
    report_file = REPORT_DIR / f"dividend_fix_report{suffix}.md"

    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report)

    print(f"\n📊 수정 리포트 저장: {report_file}")


if __name__ == "__main__":
    main()
