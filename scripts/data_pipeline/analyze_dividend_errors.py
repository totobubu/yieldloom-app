#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
배당 amount 오류 검출 스크립트

이 스크립트는 배당 데이터에서 잘못된 amount 값을 검출합니다:
1. amountFixed 기준 검증 (가장 신뢰도 높음)
2. Split 비율 역계산 검증
3. 시계열 이상치 탐지

실행 방법:
    python scripts/data_pipeline/analyze_dividend_errors.py
"""

import os
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any
import glob

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"
REPORT_DIR = ROOT_DIR / "scripts" / "data_pipeline"


class DividendErrorAnalyzer:
    def __init__(self):
        self.errors = {
            "level1_fixed_mismatch": [],      # amountFixed와 amount 불일치
            "level2_split_adjustment": [],     # Split 조정 오류
            "level3_time_series_anomaly": [],  # 시계열 이상치
            "level4_missing_original": [],     # amountOriginal은 있는데 amountFixed 없음
        }
        self.stats = {
            "total_files": 0,
            "files_with_dividends": 0,
            "files_with_splits": 0,
            "files_with_original": 0,
            "files_with_fixed": 0,
        }

    def parse_split_ratio(self, ratio_str: str) -> float:
        """Split 비율 파싱 (예: '4:1' -> 4.0, '1.5:1' -> 1.5)"""
        try:
            if ':' in ratio_str:
                parts = ratio_str.split(':')
                numerator = float(parts[0])
                denominator = float(parts[1]) if len(parts) > 1 else 1.0
                return numerator / denominator
            return float(ratio_str)
        except:
            return 1.0

    def calculate_cumulative_split_ratio(self, splits: List[Dict], before_date: str) -> float:
        """특정 날짜 이전의 누적 split 비율 계산"""
        cumulative_ratio = 1.0
        for split in splits:
            if split['date'] < before_date:
                ratio = self.parse_split_ratio(split['ratio'])
                cumulative_ratio *= ratio
        return cumulative_ratio

    def check_level1_fixed_mismatch(self, symbol: str, market: str, file_path: str,
                                     div_items: List[Dict]) -> None:
        """Level 1: amountFixed와 amount 불일치 검사"""
        for div in div_items:
            amount = div.get('amount')
            amount_fixed = div.get('amountFixed')

            if amount is not None and amount_fixed is not None:
                diff = abs(amount - amount_fixed)
                # 절대 차이가 0.01 이상이거나, 상대 차이가 1% 이상인 경우
                relative_diff = diff / amount_fixed if amount_fixed != 0 else 0

                if diff > 0.01 or relative_diff > 0.01:
                    self.errors["level1_fixed_mismatch"].append({
                        "symbol": symbol,
                        "market": market,
                        "file": file_path,
                        "date": div.get('date'),
                        "amount": amount,
                        "amountFixed": amount_fixed,
                        "difference": round(diff, 4),
                        "relative_diff_pct": round(relative_diff * 100, 2),
                        "severity": "HIGH" if relative_diff > 0.1 else "MEDIUM"
                    })

    def check_level2_split_adjustment(self, symbol: str, market: str, file_path: str,
                                       div_items: List[Dict], splits: List[Dict]) -> None:
        """Level 2: Split 비율 역계산 검증"""
        if not splits:
            return

        for div in div_items:
            amount = div.get('amount')
            amount_original = div.get('amountOriginal')
            date = div.get('date')

            if amount is None or amount_original is None or not date:
                continue

            # 해당 날짜 이후의 누적 split 비율 계산
            cumulative_ratio = self.calculate_cumulative_split_ratio(splits, date)

            if cumulative_ratio > 1.0:
                # amount = amountOriginal / cumulative_ratio 이어야 함
                expected_amount = amount_original / cumulative_ratio
                diff = abs(amount - expected_amount)
                relative_diff = diff / expected_amount if expected_amount != 0 else 0

                # 5% 이상 차이나는 경우
                if relative_diff > 0.05:
                    self.errors["level2_split_adjustment"].append({
                        "symbol": symbol,
                        "market": market,
                        "file": file_path,
                        "date": date,
                        "amount": amount,
                        "amountOriginal": amount_original,
                        "expected_amount": round(expected_amount, 4),
                        "difference": round(diff, 4),
                        "relative_diff_pct": round(relative_diff * 100, 2),
                        "cumulative_split_ratio": round(cumulative_ratio, 2),
                        "severity": "MEDIUM" if relative_diff < 0.2 else "HIGH"
                    })

    def check_level3_time_series_anomaly(self, symbol: str, market: str, file_path: str,
                                          div_items: List[Dict]) -> None:
        """Level 3: 시계열 이상치 탐지"""
        # amount만 있는 배당 항목들 추출
        amounts = []
        for div in div_items:
            if div.get('amount') is not None:
                amounts.append({
                    'date': div.get('date'),
                    'amount': div.get('amount'),
                    'has_fixed': div.get('amountFixed') is not None,
                    'has_original': div.get('amountOriginal') is not None
                })

        if len(amounts) < 3:
            return

        # 연속된 배당 간의 변화율 분석
        for i in range(1, len(amounts)):
            prev = amounts[i-1]['amount']
            curr = amounts[i]['amount']

            if prev == 0:
                continue

            change_rate = abs((curr - prev) / prev)

            # 50% 이상 급격한 변화가 있고, amountFixed나 amountOriginal이 없는 경우
            if change_rate > 0.5 and not amounts[i]['has_fixed'] and not amounts[i]['has_original']:
                self.errors["level3_time_series_anomaly"].append({
                    "symbol": symbol,
                    "market": market,
                    "file": file_path,
                    "date": amounts[i]['date'],
                    "prev_date": amounts[i-1]['date'],
                    "amount": curr,
                    "prev_amount": prev,
                    "change_rate_pct": round(change_rate * 100, 2),
                    "severity": "LOW" if change_rate < 1.0 else "MEDIUM"
                })

    def check_level4_missing_fixed(self, symbol: str, market: str, file_path: str,
                                     div_items: List[Dict], splits: List[Dict]) -> None:
        """Level 4: amountOriginal은 있는데 amountFixed가 없는 경우"""
        has_original = any(d.get('amountOriginal') is not None for d in div_items)
        has_fixed = any(d.get('amountFixed') is not None for d in div_items)

        if has_original and not has_fixed and splits:
            div_count = len([d for d in div_items if d.get('amount') or d.get('amountFixed')])
            self.errors["level4_missing_original"].append({
                "symbol": symbol,
                "market": market,
                "file": file_path,
                "splits_count": len(splits),
                "dividends_count": div_count,
                "severity": "LOW"
            })

    def analyze_file(self, file_path: str) -> None:
        """단일 파일 분석"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.stats["total_files"] += 1

            ticker_info = data.get('tickerInfo', {})
            symbol = ticker_info.get('Symbol', 'unknown')
            market = ticker_info.get('market', 'unknown')
            splits = ticker_info.get('events', {}).get('splits', [])

            backtest_data = data.get('backtestData', [])
            div_items = [x for x in backtest_data if 'amount' in x or 'amountFixed' in x]

            if not div_items:
                return

            self.stats["files_with_dividends"] += 1

            if splits:
                self.stats["files_with_splits"] += 1

            has_original = any('amountOriginal' in d for d in div_items)
            has_fixed = any('amountFixed' in d for d in div_items)

            if has_original:
                self.stats["files_with_original"] += 1
            if has_fixed:
                self.stats["files_with_fixed"] += 1

            # 각 레벨별 검사 수행
            self.check_level1_fixed_mismatch(symbol, market, file_path, div_items)
            self.check_level2_split_adjustment(symbol, market, file_path, div_items, splits)
            self.check_level3_time_series_anomaly(symbol, market, file_path, div_items)
            self.check_level4_missing_fixed(symbol, market, file_path, div_items, splits)

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    def analyze_all_files(self) -> None:
        """모든 파일 분석"""
        print("🔍 배당 데이터 오류 분석 시작...\n")

        all_files = list(glob.glob(str(DATA_DIR / "**" / "*.json"), recursive=True))
        print(f"총 {len(all_files)}개 파일 검사 중...\n")

        for i, file_path in enumerate(all_files):
            if (i + 1) % 500 == 0:
                print(f"진행률: {i+1}/{len(all_files)} ({(i+1)/len(all_files)*100:.1f}%)")
            self.analyze_file(file_path)

        print(f"\n✅ 분석 완료!\n")

    def generate_report(self) -> str:
        """리포트 생성"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        report = f"""# 배당 Amount 오류 검출 리포트

**생성 일시**: {timestamp}

## 📊 전체 통계

- **총 파일 수**: {self.stats['total_files']:,}
- **배당 데이터 보유 파일**: {self.stats['files_with_dividends']:,}
- **Split 이력 보유 파일**: {self.stats['files_with_splits']:,}
- **amountOriginal 보유 파일**: {self.stats['files_with_original']:,}
- **amountFixed 보유 파일**: {self.stats['files_with_fixed']:,}

## 🔍 오류 검출 결과

### Level 1: amountFixed vs amount 불일치 ⚠️ **HIGH PRIORITY**

**검출 건수**: {len(self.errors['level1_fixed_mismatch'])}건

이 오류는 **가장 확실한 오류**입니다. `amountFixed`는 실제 받은 배당 금액이므로, `amount`와 차이가 나는 경우 `amount`를 수정해야 합니다.

"""

        if self.errors['level1_fixed_mismatch']:
            report += "| Symbol | Market | Date | amount | amountFixed | Difference | Relative % | Severity |\n"
            report += "|--------|--------|------|--------|-------------|------------|------------|----------|\n"

            # Severity별로 정렬 (HIGH -> MEDIUM)
            sorted_errors = sorted(
                self.errors['level1_fixed_mismatch'],
                key=lambda x: (0 if x['severity'] == 'HIGH' else 1, -x['relative_diff_pct'])
            )

            for error in sorted_errors[:50]:  # 상위 50개만
                report += f"| {error['symbol']} | {error['market']} | {error['date']} | "
                report += f"{error['amount']} | {error['amountFixed']} | "
                report += f"{error['difference']} | {error['relative_diff_pct']}% | {error['severity']} |\n"

            if len(sorted_errors) > 50:
                report += f"\n... 외 {len(sorted_errors) - 50}건 더 있음\n"
        else:
            report += "✅ 오류 없음\n"

        report += f"""

### Level 2: Split 조정 오류 ⚠️ **MEDIUM PRIORITY**

**검출 건수**: {len(self.errors['level2_split_adjustment'])}건

`amountOriginal`과 split 비율로 계산한 예상 `amount`와 실제 `amount`가 5% 이상 차이나는 경우입니다.

"""

        if self.errors['level2_split_adjustment']:
            report += "| Symbol | Market | Date | amount | Expected | amountOriginal | Split Ratio | Diff % | Severity |\n"
            report += "|--------|--------|------|--------|----------|----------------|-------------|--------|----------|\n"

            sorted_errors = sorted(
                self.errors['level2_split_adjustment'],
                key=lambda x: (0 if x['severity'] == 'HIGH' else 1, -x['relative_diff_pct'])
            )

            for error in sorted_errors[:50]:
                report += f"| {error['symbol']} | {error['market']} | {error['date']} | "
                report += f"{error['amount']} | {error['expected_amount']} | "
                report += f"{error['amountOriginal']} | {error['cumulative_split_ratio']} | "
                report += f"{error['relative_diff_pct']}% | {error['severity']} |\n"

            if len(sorted_errors) > 50:
                report += f"\n... 외 {len(sorted_errors) - 50}건 더 있음\n"
        else:
            report += "✅ 오류 없음\n"

        report += f"""

### Level 3: 시계열 이상치 ℹ️ **LOW PRIORITY**

**검출 건수**: {len(self.errors['level3_time_series_anomaly'])}건

연속된 배당 간 50% 이상 급격한 변화가 있는 경우입니다. 정상적인 배당 증가/감소일 수도 있으므로 수동 확인이 필요합니다.

"""

        if self.errors['level3_time_series_anomaly']:
            report += "| Symbol | Market | Date | Prev Date | amount | Prev amount | Change % | Severity |\n"
            report += "|--------|--------|------|-----------|--------|-------------|----------|----------|\n"

            sorted_errors = sorted(
                self.errors['level3_time_series_anomaly'],
                key=lambda x: -x['change_rate_pct']
            )

            for error in sorted_errors[:30]:
                report += f"| {error['symbol']} | {error['market']} | {error['date']} | "
                report += f"{error['prev_date']} | {error['amount']} | {error['prev_amount']} | "
                report += f"{error['change_rate_pct']}% | {error['severity']} |\n"

            if len(sorted_errors) > 30:
                report += f"\n... 외 {len(sorted_errors) - 30}건 더 있음\n"
        else:
            report += "✅ 이상치 없음\n"

        report += f"""

### Level 4: amountFixed 누락 ℹ️ **INFO**

**검출 건수**: {len(self.errors['level4_missing_original'])}건

`amountOriginal`은 있지만 `amountFixed`가 없는 종목입니다. Split 이후 실제 받은 배당 금액이 기록되지 않았습니다.

"""

        if self.errors['level4_missing_original']:
            report += "| Symbol | Market | Splits | Dividends | File |\n"
            report += "|--------|--------|--------|-----------|------|\n"

            sorted_errors = sorted(
                self.errors['level4_missing_original'],
                key=lambda x: (-x['splits_count'], -x['dividends_count'])
            )

            for error in sorted_errors[:30]:
                report += f"| {error['symbol']} | {error['market']} | "
                report += f"{error['splits_count']} | {error['dividends_count']} | "
                report += f"`{error['file']}` |\n"

            if len(sorted_errors) > 30:
                report += f"\n... 외 {len(sorted_errors) - 30}건 더 있음\n"
        else:
            report += "✅ 해당 없음\n"

        report += """

## 📋 다음 단계

### 1. Level 1 오류 수정 (우선순위 높음)
- `amount`를 `amountFixed` 값으로 교체
- `amountOriginal`이 없다면 기존 `amount`를 백업

### 2. Level 2 오류 검토
- Split 비율이 정확한지 확인
- 필요시 `amount` 재계산

### 3. Level 3 이상치 수동 확인
- 실제 배당 변화인지 데이터 오류인지 확인

### 4. Level 4 정보성
- 향후 `amountFixed` 데이터 수집 필요

## 🔧 수정 스크립트 실행

Level 1 오류를 자동으로 수정하려면:
```bash
python scripts/data_pipeline/fix_dividend_errors.py --level1
```

---

*본 리포트는 자동으로 생성되었습니다. 수정 전 반드시 수동 확인이 필요합니다.*
"""

        return report

    def save_detailed_errors(self) -> None:
        """상세 오류 JSON 저장"""
        output = {
            "timestamp": datetime.now().isoformat(),
            "stats": self.stats,
            "errors": self.errors
        }

        output_file = REPORT_DIR / "dividend_errors_detail.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        print(f"📄 상세 오류 데이터 저장: {output_file}")


def main():
    analyzer = DividendErrorAnalyzer()
    analyzer.analyze_all_files()

    # 리포트 생성
    report = analyzer.generate_report()

    # 리포트 저장
    report_file = REPORT_DIR / "dividend_errors_report.md"
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report)

    print(f"📊 리포트 저장: {report_file}")

    # 상세 JSON 저장
    analyzer.save_detailed_errors()

    # 요약 출력
    print("\n" + "="*60)
    print("📊 검출 요약")
    print("="*60)
    print(f"Level 1 (HIGH):   {len(analyzer.errors['level1_fixed_mismatch'])}건")
    print(f"Level 2 (MEDIUM): {len(analyzer.errors['level2_split_adjustment'])}건")
    print(f"Level 3 (LOW):    {len(analyzer.errors['level3_time_series_anomaly'])}건")
    print(f"Level 4 (INFO):   {len(analyzer.errors['level4_missing_original'])}건")
    print("="*60)
    print(f"\n자세한 내용은 {report_file} 을 확인하세요.")


if __name__ == "__main__":
    main()
