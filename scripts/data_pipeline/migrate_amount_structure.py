#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Amount 필드 구조 마이그레이션

이 스크립트는 amount 필드를 단순 숫자에서 split 구간별 객체로 변경합니다.
amountFixed는 그대로 유지됩니다.

실행 방법:
    # Dry-run (시뮬레이션)
    python scripts/data_pipeline/migrate_amount_structure.py --dry-run

    # 특정 심볼만
    python scripts/data_pipeline/migrate_amount_structure.py --symbols ULTY,AAPL --dry-run

    # 실제 마이그레이션
    python scripts/data_pipeline/migrate_amount_structure.py

    # 과거 split 기준값도 계산
    python scripts/data_pipeline/migrate_amount_structure.py --include-historical
"""

import json
import glob
import shutil
import sys
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any
from tqdm import tqdm

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
BACKUP_DIR = ROOT_DIR / "backups" / "amount_migration"


class AmountMigrator:
    def __init__(self, dry_run=False, include_historical=False):
        self.dry_run = dry_run
        self.include_historical = include_historical
        self.stats = {
            'processed': 0,
            'migrated': 0,
            'skipped': 0,
            'errors': 0,
            'items_migrated': 0
        }
        self.errors = []

    def parse_split_ratio(self, ratio_str: str) -> float:
        """Split 비율 파싱 (예: '1:10' -> 0.1, '4:1' -> 4.0)"""
        try:
            if ':' in ratio_str:
                parts = ratio_str.split(':')
                numerator = float(parts[0])
                denominator = float(parts[1])

                # reverse-split vs split 구분
                # '1:10' (split) = 0.1, '10:1' (reverse-split) = 10
                return numerator / denominator
            return float(ratio_str)
        except:
            return 1.0

    def calculate_cumulative_ratio(self, splits: List[Dict], from_date: str, to_split_date: str) -> float:
        """
        특정 날짜부터 특정 split까지의 누적 비율 계산

        Args:
            splits: split 이력
            from_date: 배당 날짜
            to_split_date: 목표 split 날짜

        Returns:
            누적 비율
        """
        cumulative = 1.0

        for split in splits:
            split_date = split['date']

            # from_date 이후, to_split_date 이하의 split만
            if from_date < split_date <= to_split_date:
                ratio = self.parse_split_ratio(split['ratio'])
                cumulative *= ratio

        return cumulative

    def migrate_item_amount(self, item: Dict, splits: List[Dict]) -> bool:
        """
        단일 항목의 amount 필드 마이그레이션

        Returns:
            True if migrated, False if skipped
        """
        if 'amount' not in item:
            return False

        current_amount = item['amount']

        # 이미 객체면 스킵
        if isinstance(current_amount, dict):
            return False

        # 숫자가 아니면 스킵
        if not isinstance(current_amount, (int, float)):
            return False

        item_date = item['date']

        # Split 없는 경우
        if not splits:
            item['amount'] = {'current': current_amount}
            return True

        # Split 날짜 정렬
        split_dates = sorted([s['date'] for s in splits])
        latest_split = split_dates[-1]

        # Split 이후 배당
        if item_date >= latest_split:
            item['amount'] = {'current': current_amount}
            return True

        # Split 이전 배당
        amount_obj = {}

        # 기본: 가장 가까운 다음 split 기준값 (현재 YF가 조정한 값)
        for split_date in split_dates:
            if split_date > item_date:
                # 현재 amount는 최신 split 기준으로 조정된 값
                # 이 split 시점 기준값을 역계산
                ratio_to_latest = self.calculate_cumulative_ratio(splits, split_date, latest_split)

                if ratio_to_latest != 0:
                    amount_at_split = current_amount / ratio_to_latest
                    amount_obj[split_date] = round(amount_at_split, 4)
                else:
                    amount_obj[split_date] = current_amount

                break  # 가장 가까운 split만

        # 과거 모든 split 기준값 계산 (선택적)
        if self.include_historical and 'amountOriginal' in item:
            amount_original = item['amountOriginal']

            for split in splits:
                split_date = split['date']

                if split_date > item_date and split_date not in amount_obj:
                    ratio = self.calculate_cumulative_ratio(splits, item_date, split_date)
                    calculated = amount_original * ratio
                    amount_obj[split_date] = round(calculated, 4)

        item['amount'] = amount_obj
        return True

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

            # amount 필드가 있는지 확인
            has_amount = any('amount' in item for item in backtest_data)
            if not has_amount:
                self.stats['skipped'] += 1
                return False

            # 각 항목 마이그레이션
            migrated_count = 0
            for item in backtest_data:
                if self.migrate_item_amount(item, splits):
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
        print(f"🔄 Amount 필드 구조 마이그레이션")
        print(f"{'='*70}")
        print(f"모드: {mode}")
        print(f"과거 split 기준값 계산: {'예' if self.include_historical else '아니오'}")
        print(f"대상 파일: {len(target_files)}개")
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
                print(f"✓ 백업 완료: {len(files_to_backup)}개 파일\n")

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
    parser = argparse.ArgumentParser(description='Amount 필드 구조 마이그레이션')
    parser.add_argument('--dry-run', action='store_true',
                        help='실제 수정하지 않고 시뮬레이션')
    parser.add_argument('--include-historical', action='store_true',
                        help='과거 split 기준값도 계산 (amountOriginal 사용)')
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
    migrator = AmountMigrator(
        dry_run=args.dry_run,
        include_historical=args.include_historical
    )

    migrator.run(files)

    # 결과 저장
    report_file = ROOT_DIR / "scripts" / "data_pipeline" / "amount_migration_report.json"
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'dry_run': args.dry_run,
            'include_historical': args.include_historical,
            'stats': migrator.stats,
            'errors': migrator.errors
        }, f, indent=2, ensure_ascii=False)

    print(f"\n📄 상세 리포트: {report_file}")

    if not args.dry_run and migrator.stats['migrated'] > 0:
        print(f"\n✅ 마이그레이션 완료!")
        print(f"💾 백업 위치: {BACKUP_DIR / datetime.now().strftime('%Y%m%d')}*")


if __name__ == '__main__':
    main()
