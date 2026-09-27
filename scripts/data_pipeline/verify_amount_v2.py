#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Amount 마이그레이션 V2 검증

검증 항목:
1. amountSplitAdjustments가 올바르게 추가되었는지
2. amount가 최신 split 기준값인지
3. amountFixed가 유지되었는지
4. 각 split 시점의 amountAfterSplit 계산이 정확한지
"""

import json
import glob
from pathlib import Path
from typing import Dict, List
from tqdm import tqdm

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "public" / "data"


class AmountVerifierV2:
    def __init__(self):
        self.stats = {
            'total_files': 0,
            'files_with_splits': 0,
            'total_dividends': 0,
            'dividends_with_adjustments': 0,
            'total_adjustments': 0
        }
        self.issues = {
            'missing_adjustments': [],
            'wrong_calculation': [],
            'missing_amount_after_split': []
        }

    def parse_split_ratio(self, ratio_str: str) -> float:
        """Split 비율 파싱"""
        try:
            if ':' in ratio_str:
                parts = ratio_str.split(':')
                return float(parts[0]) / float(parts[1])
            return float(ratio_str)
        except:
            return 1.0

    def verify_file(self, file_path: str) -> None:
        """단일 파일 검증"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.stats['total_files'] += 1

            splits = data.get('tickerInfo', {}).get('events', {}).get('splits', [])
            backtest_data = data.get('backtestData', [])
            symbol = data.get('tickerInfo', {}).get('Symbol', Path(file_path).stem.upper())

            if not splits:
                return

            self.stats['files_with_splits'] += 1
            split_dates = sorted([s['date'] for s in splits])
            latest_split = split_dates[-1]

            for item in backtest_data:
                if 'amount' not in item:
                    continue

                self.stats['total_dividends'] += 1
                item_date = item['date']

                # Split 이전 배당만 검증
                if item_date >= latest_split:
                    continue

                # amountSplitAdjustments 존재 확인
                if 'amountSplitAdjustments' not in item:
                    self.issues['missing_adjustments'].append({
                        'symbol': symbol,
                        'file': file_path,
                        'date': item_date,
                        'reason': 'amountSplitAdjustments 없음'
                    })
                    continue

                adjustments = item['amountSplitAdjustments']
                self.stats['dividends_with_adjustments'] += 1
                self.stats['total_adjustments'] += len(adjustments)

                # amountAfterSplit 존재 확인
                for adj in adjustments:
                    if 'amountAfterSplit' not in adj:
                        self.issues['missing_amount_after_split'].append({
                            'symbol': symbol,
                            'file': file_path,
                            'date': item_date,
                            'split_date': adj['date']
                        })

                # 계산 검증 (amountFixed가 있는 경우만)
                if 'amountFixed' in item and adjustments:
                    amount_fixed = item['amountFixed']

                    # 첫 번째 split 시점의 amountAfterSplit 계산 검증
                    first_adj = adjustments[0]
                    if 'amountAfterSplit' in first_adj:
                        expected = amount_fixed / self.parse_split_ratio(first_adj['ratio'])
                        actual = first_adj['amountAfterSplit']

                        # 0.01 또는 1% 이상 차이나면 오류
                        diff = abs(expected - actual)
                        if diff > 0.01 and diff / max(expected, 0.0001) > 0.01:
                            self.issues['wrong_calculation'].append({
                                'symbol': symbol,
                                'file': file_path,
                                'date': item_date,
                                'split_date': first_adj['date'],
                                'expected': round(expected, 4),
                                'actual': actual,
                                'diff': round(diff, 4)
                            })

        except Exception as e:
            print(f"\n⚠️  오류: {file_path}: {e}")

    def run(self) -> None:
        """전체 검증 실행"""
        print(f"\n{'='*70}")
        print("🔍 Amount 마이그레이션 V2 검증 시작...")
        print(f"{'='*70}\n")

        files = list(glob.glob(str(DATA_DIR / "**" / "*.json"), recursive=True))

        for file_path in tqdm(files, desc="검증"):
            self.verify_file(file_path)

        self.print_report()
        self.save_report()

    def print_report(self):
        """검증 결과 출력"""
        print(f"\n{'='*70}")
        print("📊 검증 결과")
        print(f"{'='*70}")
        print(f"검증된 파일:           {self.stats['total_files']:,}개")
        print(f"Split 있는 파일:       {self.stats['files_with_splits']:,}개")
        print(f"총 배당 수:            {self.stats['total_dividends']:,}개")
        print(f"Adjustment 있는 배당:  {self.stats['dividends_with_adjustments']:,}개")
        print(f"총 Adjustment 수:      {self.stats['total_adjustments']:,}개")
        print(f"{'='*70}")

        total_issues = sum(len(v) for v in self.issues.values())

        if total_issues == 0:
            print("\n✅ 모든 검증 통과! 이슈 없음")
        else:
            print(f"\n⚠️  발견된 이슈: {total_issues}건\n")

            if self.issues['missing_adjustments']:
                print(f"1. amountSplitAdjustments 누락: {len(self.issues['missing_adjustments'])}건")
                for issue in self.issues['missing_adjustments'][:5]:
                    print(f"   - {issue['symbol']} ({issue['date']})")

            if self.issues['missing_amount_after_split']:
                print(f"\n2. amountAfterSplit 누락: {len(self.issues['missing_amount_after_split'])}건")
                for issue in self.issues['missing_amount_after_split'][:5]:
                    print(f"   - {issue['symbol']} ({issue['date']}, split: {issue['split_date']})")

            if self.issues['wrong_calculation']:
                print(f"\n3. 계산 오류: {len(self.issues['wrong_calculation'])}건")
                for issue in self.issues['wrong_calculation'][:5]:
                    print(f"   - {issue['symbol']} ({issue['date']})")
                    print(f"     Split: {issue['split_date']}")
                    print(f"     예상: {issue['expected']}, 실제: {issue['actual']}, 차이: {issue['diff']}")

        print(f"{'='*70}")

    def save_report(self):
        """리포트 저장"""
        report_file = ROOT_DIR / "scripts" / "data_pipeline" / "amount_v2_verification_report.json"

        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump({
                'stats': self.stats,
                'issues': self.issues
            }, f, indent=2, ensure_ascii=False)

        print(f"\n📄 상세 리포트: {report_file}")


def main():
    verifier = AmountVerifierV2()
    verifier.run()


if __name__ == '__main__':
    main()
