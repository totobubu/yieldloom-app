#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Amount 필드 구조 마이그레이션 V2

새로운 구조:
- amount: 최신 split 기준 최종 값 (단순 숫자)
- amountSplitAdjustments: 각 split 시점의 값 히스토리 (amountAfterSplit 추가)
- amountFixed: 실제 받은 금액 (변경 없음)
- amountOriginal: YF 원본 값 (백업, 변경 없음)

실행 방법:
    # Dry-run (시뮬레이션)
    PYTHONIOENCODING=utf-8 python scripts/data_pipeline/migrate_amount_v2.py --dry-run

    # 실제 마이그레이션
    PYTHONIOENCODING=utf-8 python scripts/data_pipeline/migrate_amount_v2.py

    # 특정 마켓만
    PYTHONIOENCODING=utf-8 python scripts/data_pipeline/migrate_amount_v2.py --market NYSE
"""

import json
import glob
import shutil
import sys
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional
from tqdm import tqdm

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
BACKUP_DIR = ROOT_DIR / "backups" / "amount_migration_v2"


class AmountMigratorV2:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.stats = {
            'processed': 0,
            'migrated': 0,
            'skipped': 0,
            'errors': 0,
            'items_migrated': 0,
            'split_adjustments_added': 0
        }
        self.errors = []

    def parse_split_ratio(self, ratio_str: str) -> float:
        """Split 비율 파싱 (예: '1:10' -> 0.1, '4:1' -> 4.0)"""
        try:
            if ':' in ratio_str:
                parts = ratio_str.split(':')
                numerator = float(parts[0])
                denominator = float(parts[1])
                return numerator / denominator
            return float(ratio_str)
        except:
            return 1.0

    def calculate_amount_at_split(self, amount_original: float, splits: List[Dict],
                                  item_date: str, target_split_date: str) -> float:
        """
        특정 split 시점의 배당 금액 계산

        Args:
            amount_original: 실제 받은 배당 (amountFixed 또는 amountOriginal)
            splits: split 이력
            item_date: 배당 날짜
            target_split_date: 계산할 split 날짜

        Returns:
            해당 split 시점의 배당 금액
        """
        cumulative_ratio = 1.0

        # item_date부터 target_split_date까지의 모든 split 적용
        for split in splits:
            split_date = split['date']

            # 배당 날짜 이후, 목표 split 날짜 이하의 split만
            if item_date < split_date <= target_split_date:
                ratio = self.parse_split_ratio(split['ratio'])
                cumulative_ratio *= ratio

        return amount_original / cumulative_ratio

    def migrate_item_amount(self, item: Dict, splits: List[Dict], symbol: str) -> bool:
        """
        단일 항목의 amount 필드 마이그레이션

        새로운 구조:
        - amount: 최신 split 기준 최종 값 (숫자)
        - amountSplitAdjustments: 각 split 시점의 amountAfterSplit 추가

        Returns:
            True if migrated, False if skipped
        """
        if 'amount' not in item:
            return False

        current_amount = item['amount']

        # 이미 처리되었거나 객체 형태면 스킵
        if isinstance(current_amount, dict):
            return False

        # 숫자가 아니면 스킵
        if not isinstance(current_amount, (int, float)):
            return False

        item_date = item['date']

        # amountFixed가 실제 받은 금액 (가장 신뢰할 수 있는 값)
        amount_original = item.get('amountFixed', current_amount)

        # amountOriginal 백업이 없으면 현재 amount를 백업
        if 'amountOriginal' not in item:
            item['amountOriginal'] = current_amount

        # Split이 없는 경우 - amount 그대로 유지
        if not splits:
            # amount는 이미 올바른 값이므로 변경 불필요
            return False

        # Split 날짜 정렬
        split_dates = sorted([s['date'] for s in splits])
        latest_split = split_dates[-1]

        # Split 이후 배당 - amount 그대로 유지
        if item_date >= latest_split:
            return False

        # Split 이전 배당 - amountSplitAdjustments 업데이트 필요

        # 기존 amountSplitAdjustments 가져오기
        if 'amountSplitAdjustments' not in item:
            item['amountSplitAdjustments'] = []

        adjustments = item['amountSplitAdjustments']
        existing_splits = {adj['date'] for adj in adjustments}

        # 이 배당에 영향을 주는 모든 split에 대해 amountAfterSplit 계산
        added_count = 0
        for split in splits:
            split_date = split['date']

            # 배당 이후의 split만 처리
            if split_date <= item_date:
                continue

            # 이미 처리된 split인지 확인
            adjustment = None
            for adj in adjustments:
                if adj['date'] == split_date:
                    adjustment = adj
                    break

            # 새 adjustment 추가
            if adjustment is None:
                adjustment = {
                    'date': split_date,
                    'ratio': split.get('ratio', '1:1'),
                    'factor': self.parse_split_ratio(split.get('ratio', '1:1'))
                }
                adjustments.append(adjustment)

            # amountAfterSplit 계산 및 추가
            if 'amountAfterSplit' not in adjustment:
                amount_at_split = self.calculate_amount_at_split(
                    amount_original, splits, item_date, split_date
                )
                adjustment['amountAfterSplit'] = round(amount_at_split, 4)
                added_count += 1

        # Split 날짜순 정렬
        item['amountSplitAdjustments'] = sorted(adjustments, key=lambda x: x['date'])

        # amount를 최신 split 기준값으로 업데이트
        # (현재 YF의 amount가 이미 최신 기준이므로 대부분의 경우 변경 없음)
        latest_amount = self.calculate_amount_at_split(
            amount_original, splits, item_date, latest_split
        )
        item['amount'] = round(latest_amount, 4)

        return added_count > 0

    def migrate_file(self, file_path: str) -> bool:
        """
        단일 파일 마이그레이션

        Returns:
            True if migrated, False if skipped or error
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.stats['processed'] += 1

            splits = data.get('tickerInfo', {}).get('events', {}).get('splits', [])
            backtest_data = data.get('backtestData', [])
            symbol = data.get('tickerInfo', {}).get('Symbol', Path(file_path).stem.upper())

            # amount 필드가 있는지 확인
            has_amount = any('amount' in item for item in backtest_data)
            if not has_amount:
                self.stats['skipped'] += 1
                return False

            # 각 항목 마이그레이션
            migrated_count = 0
            for item in backtest_data:
                if self.migrate_item_amount(item, splits, symbol):
                    migrated_count += 1

            if migrated_count == 0:
                self.stats['skipped'] += 1
                return False

            # 저장
            if not self.dry_run:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=4, ensure_ascii=False)

            self.stats['migrated'] += 1
            self.stats['items_migrated'] += migrated_count

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

        print(f"\n💾 백업 생성 중: {backup_path}")

        for file_path in tqdm(files, desc="백업"):
            try:
                rel_path = Path(file_path).relative_to(DATA_DIR)
                backup_file = backup_path / rel_path
                backup_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file_path, backup_file)
            except Exception as e:
                print(f"⚠️  백업 실패: {file_path}: {e}")

        return backup_path

    def run(self, target_files: List[str]) -> None:
        """마이그레이션 실행"""
        mode = "DRY-RUN (시뮬레이션)" if self.dry_run else "실제 마이그레이션"
        print(f"\n{'='*70}")
        print(f"🔄 Amount 필드 구조 마이그레이션 V2")
        print(f"{'='*70}")
        print(f"모드: {mode}")
        print(f"대상 파일: {len(target_files):,}개")
        print(f"{'='*70}\n")

        # 백업 생성 (실제 마이그레이션 시에만)
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
                print(f"✓ 백업 완료: {len(files_to_backup):,}개 파일\n")

        # 마이그레이션
        print("🔄 마이그레이션 진행 중...\n")

        for file_path in tqdm(target_files, desc="처리"):
            self.migrate_file(file_path)

        # 결과 출력
        self.print_summary()

    def print_summary(self):
        """결과 요약 출력"""
        print(f"\n{'='*70}")
        print("📊 마이그레이션 결과")
        print(f"{'='*70}")
        print(f"처리된 파일:       {self.stats['processed']:,}개")
        print(f"  - 마이그레이션됨: {self.stats['migrated']:,}개")
        print(f"  - 스킵됨:        {self.stats['skipped']:,}개")
        print(f"  - 오류:          {self.stats['errors']:,}개")
        print(f"마이그레이션 항목: {self.stats['items_migrated']:,}개")

        if self.errors:
            print(f"\n⚠️  오류 발생 파일 ({len(self.errors)}개):")
            for error in self.errors[:10]:
                print(f"  - {error['file']}")
                print(f"    {error['error']}")
            if len(self.errors) > 10:
                print(f"  ... 외 {len(self.errors) - 10}개 더")

        print(f"{'='*70}")


def main():
    parser = argparse.ArgumentParser(description='Amount 필드 구조 마이그레이션 V2')
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
        print("❌ 대상 파일이 없습니다.")
        return

    # 마이그레이션 실행
    migrator = AmountMigratorV2(dry_run=args.dry_run)
    migrator.run(files)

    # 결과 저장
    report_file = ROOT_DIR / "scripts" / "data_pipeline" / "amount_migration_v2_report.json"
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'dry_run': args.dry_run,
            'stats': migrator.stats,
            'errors': migrator.errors
        }, f, indent=2, ensure_ascii=False)

    print(f"\n📄 상세 리포트: {report_file}")

    if not args.dry_run and migrator.stats['migrated'] > 0:
        print(f"\n✅ 마이그레이션 완료!")
        print(f"💾 백업 위치: {BACKUP_DIR}")


if __name__ == '__main__':
    main()
