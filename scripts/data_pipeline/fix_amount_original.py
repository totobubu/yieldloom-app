#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
amountOriginal 필드 수정 스크립트

문제:
- amountOriginal이 split ratio만큼 잘못 곱해져 있음 (예: 0.096이어야 하는데 0.96)
- ULTY의 경우 1:10 split으로 인해 10배 차이

수정 원칙:
- amountOriginal = amountFixed (실제 받은 금액과 동일해야 함)
- Split 조정은 amount 필드에만 반영

실행 방법:
    # Dry-run (시뮬레이션)
    PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_amount_original.py --dry-run

    # 실제 수정
    PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_amount_original.py

    # 특정 심볼만
    PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_amount_original.py --symbols ULTY
"""

import json
import glob
import shutil
import sys
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List
from tqdm import tqdm

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
BACKUP_DIR = ROOT_DIR / "backups" / "fix_amount_original"


class AmountOriginalFixer:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.stats = {
            'processed_files': 0,
            'fixed_files': 0,
            'skipped_files': 0,
            'errors': 0,
            'items_fixed': 0
        }
        self.errors = []
        self.fixes = []

    def fix_item(self, item: Dict, symbol: str) -> bool:
        """
        단일 항목의 amountOriginal 수정

        수정 규칙:
        1. amountFixed가 있으면 amountOriginal = amountFixed
        2. amountFixed가 없고 amountSplitAdjustments가 있으면 역산
        3. 둘 다 없으면 스킵

        Returns:
            True if fixed, False if skipped
        """
        if 'amount' not in item:
            return False

        item_date = item['date']
        amount_fixed = item.get('amountFixed')
        amount_original = item.get('amountOriginal')

        fixed = False

        # amountFixed가 있는 경우만 수정
        if amount_fixed is not None:
            # amountOriginal이 amountFixed와 다르면 수정
            if amount_original != amount_fixed:
                old_value = amount_original
                item['amountOriginal'] = amount_fixed

                self.fixes.append({
                    'symbol': symbol,
                    'date': item_date,
                    'old_original': old_value,
                    'new_original': amount_fixed,
                    'amount_fixed': amount_fixed
                })
                fixed = True

        return fixed

    def fix_file(self, file_path: str) -> bool:
        """
        단일 파일 수정

        Returns:
            True if fixed, False if skipped or error
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.stats['processed_files'] += 1

            backtest_data = data.get('backtestData', [])
            symbol = data.get('tickerInfo', {}).get('Symbol', Path(file_path).stem.upper())

            # amount 필드가 있는지 확인
            has_amount = any('amount' in item for item in backtest_data)
            if not has_amount:
                self.stats['skipped_files'] += 1
                return False

            # 각 항목 수정
            fixed_count = 0

            for item in backtest_data:
                if self.fix_item(item, symbol):
                    fixed_count += 1

            if fixed_count == 0:
                self.stats['skipped_files'] += 1
                return False

            # 저장
            if not self.dry_run:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=4, ensure_ascii=False)

            self.stats['fixed_files'] += 1
            self.stats['items_fixed'] += fixed_count

            return True

        except Exception as e:
            self.stats['errors'] += 1
            self.errors.append({
                'file': file_path,
                'error': str(e)
            })
            return False

    def create_backup(self, files: List[str]) -> Path:
        """전체 백업 생성"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = BACKUP_DIR / timestamp
        backup_path.mkdir(parents=True, exist_ok=True)

        print(f"\n백업 생성 중: {backup_path}")

        for file_path in tqdm(files, desc="백업"):
            try:
                rel_path = Path(file_path).relative_to(DATA_DIR)
                backup_file = backup_path / rel_path
                backup_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file_path, backup_file)
            except Exception as e:
                print(f"백업 실패: {file_path}: {e}")

        return backup_path

    def run(self, target_files: List[str]) -> None:
        """수정 실행"""
        mode = "DRY-RUN (시뮬레이션)" if self.dry_run else "실제 수정"
        print(f"\n{'='*70}")
        print(f"amountOriginal 필드 수정")
        print(f"{'='*70}")
        print(f"모드: {mode}")
        print(f"대상 파일: {len(target_files):,}개")
        print(f"{'='*70}\n")

        # 백업 생성 (실제 수정 시에만)
        if not self.dry_run:
            # amount 필드가 있는 파일만 백업
            files_to_backup = []
            for file_path in target_files:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if any('amount' in item for item in data.get('backtestData', [])):
                        files_to_backup.append(file_path)
                except:
                    pass

            if files_to_backup:
                backup_path = self.create_backup(files_to_backup)
                print(f"백업 완료: {len(files_to_backup):,}개 파일\n")

        # 수정
        print("수정 진행 중...\n")

        for file_path in tqdm(target_files, desc="처리"):
            self.fix_file(file_path)

        # 결과 출력
        self.print_summary()

    def print_summary(self):
        """결과 요약 출력"""
        print(f"\n{'='*70}")
        print("수정 결과")
        print(f"{'='*70}")
        print(f"처리된 파일:     {self.stats['processed_files']:,}개")
        print(f"  - 수정됨:      {self.stats['fixed_files']:,}개")
        print(f"  - 스킵됨:      {self.stats['skipped_files']:,}개")
        print(f"  - 오류:        {self.stats['errors']:,}개")
        print(f"수정된 항목:     {self.stats['items_fixed']:,}개")

        # 수정 내역 샘플 출력
        if self.fixes:
            print(f"\n수정 내역 샘플 (처음 10개):")
            for fix in self.fixes[:10]:
                print(f"  {fix['symbol']} {fix['date']}: {fix['old_original']} -> {fix['new_original']}")
            if len(self.fixes) > 10:
                print(f"  ... 외 {len(self.fixes) - 10}개 더")

        if self.errors:
            print(f"\n오류 발생 파일 ({len(self.errors)}개):")
            for error in self.errors[:10]:
                print(f"  - {error['file']}")
                print(f"    {error['error']}")
            if len(self.errors) > 10:
                print(f"  ... 외 {len(self.errors) - 10}개 더")

        print(f"{'='*70}")


def main():
    parser = argparse.ArgumentParser(description='amountOriginal 필드 수정')
    parser.add_argument('--dry-run', action='store_true',
                        help='실제 수정하지 않고 시뮬레이션')
    parser.add_argument('--symbols', type=str,
                        help='특정 심볼만 처리 (쉼표로 구분, 예: ULTY,AAPL)')
    parser.add_argument('--market', type=str,
                        help='특정 마켓만 처리 (예: NYSE, NASDAQ, KOSDAQ)')

    args = parser.parse_args()

    # 대상 파일 수집
    files = list(glob.glob(str(DATA_DIR / "**" / "*.json"), recursive=True))

    # 필터링
    if args.symbols:
        target_symbols = set(s.strip().upper() for s in args.symbols.split(','))
        files = [f for f in files if any(sym.lower() in Path(f).stem.lower() for sym in target_symbols)]

    if args.market:
        filtered = []
        for f in files:
            try:
                with open(f, 'r', encoding='utf-8') as file:
                    data = json.load(file)
                    market = data.get('tickerInfo', {}).get('market', '')
                    if market.upper() == args.market.upper():
                        filtered.append(f)
            except:
                pass
        files = filtered

    if not files:
        print("대상 파일이 없습니다.")
        return

    # 수정 실행
    fixer = AmountOriginalFixer(dry_run=args.dry_run)
    fixer.run(files)

    # 결과 저장
    report_file = ROOT_DIR / "scripts" / "data_pipeline" / "fix_amount_original_report.json"
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'dry_run': args.dry_run,
            'stats': fixer.stats,
            'fixes': fixer.fixes[:100],  # 처음 100개만 저장
            'errors': fixer.errors
        }, f, indent=2, ensure_ascii=False)

    print(f"\n상세 리포트: {report_file}")

    if not args.dry_run and fixer.stats['fixed_files'] > 0:
        print(f"\n수정 완료!")
        print(f"백업 위치: {BACKUP_DIR}")


if __name__ == '__main__':
    main()
