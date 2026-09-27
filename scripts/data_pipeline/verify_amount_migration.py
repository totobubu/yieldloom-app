#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Amount 마이그레이션 검증 스크립트

마이그레이션 후 데이터 무결성을 검증합니다.

실행 방법:
    python scripts/data_pipeline/verify_amount_migration.py
"""

import json
import glob
import sys
from pathlib import Path
from typing import Dict, List, Any

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"


class MigrationVerifier:
    def __init__(self):
        self.issues = {
            'wrong_type': [],           # amount가 객체가 아님
            'missing_keys': [],         # amount 객체에 키가 없음
            'invalid_split_ref': [],    # 존재하지 않는 split 날짜 참조
            'mismatch_with_fixed': [],  # amountFixed와 current가 다름
            'empty_object': []          # 빈 객체
        }
        self.stats = {
            'total_files': 0,
            'verified_files': 0,
            'total_items': 0,
            'migrated_items': 0,
            'current_only': 0,
            'with_split_dates': 0
        }

    def verify_item(self, item: Dict, splits: List[Dict], symbol: str, file_path: str) -> None:
        """단일 항목 검증"""
        if 'amount' not in item:
            return

        self.stats['total_items'] += 1
        amount = item['amount']
        item_date = item['date']

        # 1. 타입 체크
        if not isinstance(amount, dict):
            self.issues['wrong_type'].append({
                'symbol': symbol,
                'file': file_path,
                'date': item_date,
                'type': type(amount).__name__,
                'value': amount
            })
            return

        self.stats['migrated_items'] += 1

        # 2. 빈 객체 체크
        if not amount:
            self.issues['empty_object'].append({
                'symbol': symbol,
                'file': file_path,
                'date': item_date
            })
            return

        # 3. 키 분석
        has_current = 'current' in amount
        split_keys = [k for k in amount.keys() if k != 'current']

        if has_current:
            self.stats['current_only'] += 1
        if split_keys:
            self.stats['with_split_dates'] += 1

        # 4. Split 날짜 검증
        split_dates = [s['date'] for s in splits]
        for split_key in split_keys:
            if split_key not in split_dates:
                self.issues['invalid_split_ref'].append({
                    'symbol': symbol,
                    'file': file_path,
                    'date': item_date,
                    'invalid_key': split_key,
                    'valid_splits': split_dates
                })

        # 5. amountFixed와 비교
        if 'amountFixed' in item and has_current:
            amount_fixed = item['amountFixed']
            amount_current = amount['current']

            # Split 이후 배당이면 current와 fixed가 같아야 함
            latest_split = split_dates[-1] if split_dates else None
            if not latest_split or item_date >= latest_split:
                # 1% 이상 차이나면 기록
                if abs(amount_current - amount_fixed) / amount_fixed > 0.01:
                    self.issues['mismatch_with_fixed'].append({
                        'symbol': symbol,
                        'file': file_path,
                        'date': item_date,
                        'current': amount_current,
                        'fixed': amount_fixed,
                        'diff': amount_current - amount_fixed
                    })

    def verify_file(self, file_path: str) -> None:
        """단일 파일 검증"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.stats['total_files'] += 1

            ticker_info = data.get('tickerInfo', {})
            symbol = ticker_info.get('Symbol', 'unknown')
            splits = ticker_info.get('events', {}).get('splits', [])
            backtest_data = data.get('backtestData', [])

            # 각 항목 검증
            for item in backtest_data:
                self.verify_item(item, splits, symbol, file_path)

            self.stats['verified_files'] += 1

        except Exception as e:
            print(f"⚠️  {file_path}: {e}")

    def run(self, files: List[str]) -> None:
        """검증 실행"""
        print("\n🔍 마이그레이션 검증 시작...\n")

        from tqdm import tqdm
        for file_path in tqdm(files, desc="검증"):
            self.verify_file(file_path)

        self.print_report()

    def print_report(self):
        """검증 결과 리포트"""
        print(f"\n{'='*70}")
        print("📊 검증 결과")
        print(f"{'='*70}")
        print(f"검증된 파일:       {self.stats['verified_files']:,}개")
        print(f"총 항목 수:        {self.stats['total_items']:,}개")
        print(f"마이그레이션 항목: {self.stats['migrated_items']:,}개")
        print(f"  - current만:     {self.stats['current_only']:,}개")
        print(f"  - split 날짜 포함: {self.stats['with_split_dates']:,}개")

        # 이슈 요약
        print(f"\n{'='*70}")
        print("⚠️  발견된 이슈")
        print(f"{'='*70}")

        total_issues = sum(len(v) for v in self.issues.values())
        if total_issues == 0:
            print("✅ 이슈 없음!")
        else:
            print(f"총 {total_issues}개 이슈 발견:\n")

            if self.issues['wrong_type']:
                print(f"1. 잘못된 타입: {len(self.issues['wrong_type'])}건")
                for issue in self.issues['wrong_type'][:5]:
                    print(f"   - {issue['symbol']} ({issue['date']}): {issue['type']}")

            if self.issues['empty_object']:
                print(f"\n2. 빈 객체: {len(self.issues['empty_object'])}건")
                for issue in self.issues['empty_object'][:5]:
                    print(f"   - {issue['symbol']} ({issue['date']})")

            if self.issues['invalid_split_ref']:
                print(f"\n3. 잘못된 split 참조: {len(self.issues['invalid_split_ref'])}건")
                for issue in self.issues['invalid_split_ref'][:5]:
                    print(f"   - {issue['symbol']} ({issue['date']}): {issue['invalid_key']}")

            if self.issues['mismatch_with_fixed']:
                print(f"\n4. amountFixed 불일치: {len(self.issues['mismatch_with_fixed'])}건")
                for issue in self.issues['mismatch_with_fixed'][:5]:
                    print(f"   - {issue['symbol']} ({issue['date']}): current={issue['current']}, fixed={issue['fixed']}")

        print(f"{'='*70}")

        # 상세 리포트 저장
        report_file = ROOT_DIR / "scripts" / "data_pipeline" / "amount_verification_report.json"
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump({
                'stats': self.stats,
                'issues': self.issues
            }, f, indent=2, ensure_ascii=False)

        print(f"\n📄 상세 리포트: {report_file}")


def main():
    files = list(glob.glob(str(DATA_DIR / "**" / "*.json"), recursive=True))

    verifier = MigrationVerifier()
    verifier.run(files)

    # 결과에 따라 exit code 설정
    total_issues = sum(len(v) for v in verifier.issues.values())
    if total_issues > 0:
        print(f"\n⚠️  {total_issues}개 이슈 발견. 수정이 필요합니다.")
        sys.exit(1)
    else:
        print("\n✅ 검증 완료! 모든 데이터가 정상입니다.")
        sys.exit(0)


if __name__ == '__main__':
    main()
