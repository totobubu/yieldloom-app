#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Amount 필드 마이그레이션 영향도 분석

이 스크립트는 amount 필드를 객체 구조로 변경할 때의 영향도를 분석합니다.

실행 방법:
    python scripts/data_pipeline/analyze_amount_migration.py
"""

import json
import glob
import sys
from pathlib import Path
from collections import defaultdict

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"


def analyze_migration_impact():
    """마이그레이션 영향도 분석"""

    stats = {
        'total_files': 0,
        'files_with_dividends': 0,
        'files_with_splits': 0,
        'files_with_amount': 0,
        'files_with_amount_fixed': 0,
        'items_to_migrate': 0,
        'splits_distribution': defaultdict(int),
        'market_distribution': defaultdict(int),
        'sample_files': {
            'no_splits': [],
            'one_split': [],
            'multiple_splits': []
        }
    }

    files = list(glob.glob(str(DATA_DIR / "**" / "*.json"), recursive=True))

    print("🔍 Amount 필드 마이그레이션 영향도 분석 시작...\n")

    for file_path in files:
        stats['total_files'] += 1

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            ticker_info = data.get('tickerInfo', {})
            symbol = ticker_info.get('Symbol', 'unknown')
            market = ticker_info.get('market', 'unknown')

            splits = ticker_info.get('events', {}).get('splits', [])
            backtest = data.get('backtestData', [])

            # amount 필드가 있는 항목
            amount_items = [x for x in backtest if 'amount' in x]
            amount_fixed_items = [x for x in backtest if 'amountFixed' in x]

            if amount_items:
                stats['files_with_dividends'] += 1
                stats['files_with_amount'] += 1
                stats['items_to_migrate'] += len(amount_items)
                stats['market_distribution'][market] += 1

            if amount_fixed_items:
                stats['files_with_amount_fixed'] += 1

            if splits:
                stats['files_with_splits'] += 1
                split_count = len(splits)
                stats['splits_distribution'][split_count] += 1

                # 샘플 파일 수집
                if split_count == 1 and len(stats['sample_files']['one_split']) < 5:
                    stats['sample_files']['one_split'].append({
                        'symbol': symbol,
                        'market': market,
                        'file': file_path,
                        'splits': splits,
                        'dividends': len(amount_items)
                    })
                elif split_count > 1 and len(stats['sample_files']['multiple_splits']) < 5:
                    stats['sample_files']['multiple_splits'].append({
                        'symbol': symbol,
                        'market': market,
                        'file': file_path,
                        'splits': splits,
                        'dividends': len(amount_items)
                    })
            else:
                if amount_items and len(stats['sample_files']['no_splits']) < 5:
                    stats['sample_files']['no_splits'].append({
                        'symbol': symbol,
                        'market': market,
                        'file': file_path,
                        'dividends': len(amount_items)
                    })

        except Exception as e:
            print(f"⚠️  {file_path}: {e}")

    return stats


def print_report(stats):
    """분석 결과 리포트 출력"""

    print("=" * 70)
    print("📊 전체 통계")
    print("=" * 70)
    print(f"총 파일 수:              {stats['total_files']:,}")
    print(f"배당 데이터 보유:        {stats['files_with_dividends']:,}")
    print(f"  - amount 보유:         {stats['files_with_amount']:,}")
    print(f"  - amountFixed 보유:    {stats['files_with_amount_fixed']:,}")
    print(f"Split 이력 보유:         {stats['files_with_splits']:,}")
    print(f"마이그레이션 대상 항목:  {stats['items_to_migrate']:,}개")

    print("\n" + "=" * 70)
    print("📈 마켓별 분포")
    print("=" * 70)
    for market in sorted(stats['market_distribution'].keys()):
        count = stats['market_distribution'][market]
        print(f"{market:10s}: {count:,}개 파일")

    print("\n" + "=" * 70)
    print("🔀 Split 횟수별 분포")
    print("=" * 70)
    if stats['splits_distribution']:
        for count in sorted(stats['splits_distribution'].keys()):
            files = stats['splits_distribution'][count]
            print(f"{count:2d}번 split: {files:4,}개 파일")
    else:
        print("Split 데이터 없음")

    # 샘플 파일
    print("\n" + "=" * 70)
    print("📋 샘플 파일 (각 카테고리별)")
    print("=" * 70)

    print("\n▶ Split 없는 종목:")
    for sample in stats['sample_files']['no_splits']:
        print(f"  - {sample['symbol']:8s} ({sample['market']:6s}): {sample['dividends']:3d}개 배당")

    print("\n▶ 1번 Split:")
    for sample in stats['sample_files']['one_split']:
        print(f"  - {sample['symbol']:8s} ({sample['market']:6s}): {len(sample['splits'])}번 split, {sample['dividends']:3d}개 배당")
        print(f"    Split: {sample['splits'][0]['date']} ({sample['splits'][0]['ratio']})")

    print("\n▶ 여러 번 Split:")
    for sample in stats['sample_files']['multiple_splits']:
        print(f"  - {sample['symbol']:8s} ({sample['market']:6s}): {len(sample['splits'])}번 split, {sample['dividends']:3d}개 배당")
        for split in sample['splits'][-2:]:  # 최근 2개만
            print(f"    Split: {split['date']} ({split['ratio']})")

    print("\n" + "=" * 70)
    print("💡 예상 영향")
    print("=" * 70)
    print(f"✓ {stats['files_with_amount']:,}개 파일의 amount 필드가 객체로 변경됩니다")
    print(f"✓ {stats['items_to_migrate']:,}개 배당 항목이 영향받습니다")
    print(f"✓ amountFixed는 {stats['files_with_amount_fixed']:,}개 파일에서 그대로 유지됩니다")
    print(f"✓ Split 없는 파일은 'current' 키만 사용합니다")
    print(f"✓ Split 있는 파일({stats['files_with_splits']:,}개)은 날짜별 키를 사용합니다")


def main():
    stats = analyze_migration_impact()
    print_report(stats)

    # JSON으로도 저장
    output_file = ROOT_DIR / "scripts" / "data_pipeline" / "amount_migration_analysis.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        # defaultdict를 일반 dict로 변환
        stats_serializable = {
            **stats,
            'splits_distribution': dict(stats['splits_distribution']),
            'market_distribution': dict(stats['market_distribution'])
        }
        json.dump(stats_serializable, f, indent=2, ensure_ascii=False)

    print(f"\n📄 상세 분석 결과: {output_file}")


if __name__ == '__main__':
    main()
