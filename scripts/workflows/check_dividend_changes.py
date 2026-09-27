"""
배당금 데이터 변경 감지 스크립트

public/data 안의 JSON 파일에서 backtestData의 amount, amountFixed, expected 필드 변경을 확인합니다.
GitHub Actions에서 사용하기 위한 스크립트입니다.
"""

import json
import os
import sys
import subprocess
from pathlib import Path
from typing import Dict, List, Set, Any


def get_changed_data_files() -> List[str]:
    """Git diff를 사용해서 변경된 public/data/*.json 파일 목록 반환"""
    try:
        # 이전 커밋과 현재 HEAD 비교
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            # 첫 커밋이거나 비교할 대상이 없는 경우 모든 변경사항 확인
            result = subprocess.run(
                ["git", "diff", "--name-only", "--cached"],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                result = subprocess.run(
                    ["git", "diff", "--name-only"],
                    capture_output=True,
                    text=True,
                    check=False,
                )

        changed_files = result.stdout.strip().split("\n")
        data_files = [
            f
            for f in changed_files
            if f.startswith("public/data/") and f.endswith(".json")
        ]
        return data_files
    except Exception as e:
        print(f"[WARNING] Git diff 실패: {e}", file=sys.stderr)
        return []


def extract_dividend_fields(data: Dict[str, Any]) -> Dict[str, Set[str]]:
    """
    backtestData에서 amount, amountFixed, expected 필드 추출

    Returns:
        dict: {
            'dates_with_amount': set of dates,
            'dates_with_amountFixed': set of dates,
            'dates_with_expected': set of dates
        }
    """
    result = {
        "dates_with_amount": set(),
        "dates_with_amountFixed": set(),
        "dates_with_expected": set(),
    }

    backtest_data = data.get("backtestData", [])
    if not isinstance(backtest_data, list):
        return result

    for entry in backtest_data:
        if not isinstance(entry, dict):
            continue

        date = entry.get("date")
        if not date:
            continue

        # 각 필드 존재 여부 확인
        if "amount" in entry and entry["amount"] is not None:
            result["dates_with_amount"].add(date)
        if "amountFixed" in entry and entry["amountFixed"] is not None:
            result["dates_with_amountFixed"].add(date)
        if "expected" in entry:
            result["dates_with_expected"].add(date)

    return result


def check_file_changes(file_path: str) -> bool:
    """특정 파일의 배당금 필드 변경 여부 확인"""
    try:
        # 현재 버전 읽기
        current_path = Path(file_path)
        if not current_path.exists():
            return False

        with open(current_path, "r", encoding="utf-8") as f:
            current_data = json.load(f)

        current_fields = extract_dividend_fields(current_data)

        # 이전 버전 읽기 (HEAD~1)
        try:
            result = subprocess.run(
                ["git", "show", f"HEAD~1:{file_path}"],
                capture_output=True,
                text=True,
                check=True,
            )
            previous_data = json.loads(result.stdout)
            previous_fields = extract_dividend_fields(previous_data)
        except subprocess.CalledProcessError:
            # 이전 버전이 없는 경우 (새 파일) 현재 버전에 필드가 있으면 변경으로 간주
            return (
                len(current_fields["dates_with_amount"]) > 0
                or len(current_fields["dates_with_amountFixed"]) > 0
                or len(current_fields["dates_with_expected"]) > 0
            )

        # 필드 값 비교
        # amount 필드 변경 확인
        if current_fields["dates_with_amount"] != previous_fields["dates_with_amount"]:
            # 날짜가 같지만 값이 다를 수 있으므로 실제 값 비교
            current_backtest = current_data.get("backtestData", [])
            previous_backtest = previous_data.get("backtestData", [])

            current_amount_map = {
                entry.get("date"): entry.get("amount")
                for entry in current_backtest
                if isinstance(entry, dict) and "amount" in entry
            }
            previous_amount_map = {
                entry.get("date"): entry.get("amount")
                for entry in previous_backtest
                if isinstance(entry, dict) and "amount" in entry
            }

            if current_amount_map != previous_amount_map:
                return True

        # amountFixed 필드 변경 확인
        if (
            current_fields["dates_with_amountFixed"]
            != previous_fields["dates_with_amountFixed"]
        ):
            current_backtest = current_data.get("backtestData", [])
            previous_backtest = previous_data.get("backtestData", [])

            current_amount_fixed_map = {
                entry.get("date"): entry.get("amountFixed")
                for entry in current_backtest
                if isinstance(entry, dict) and "amountFixed" in entry
            }
            previous_amount_fixed_map = {
                entry.get("date"): entry.get("amountFixed")
                for entry in previous_backtest
                if isinstance(entry, dict) and "amountFixed" in entry
            }

            if current_amount_fixed_map != previous_amount_fixed_map:
                return True

        # expected 필드 변경 확인
        if (
            current_fields["dates_with_expected"]
            != previous_fields["dates_with_expected"]
        ):
            current_backtest = current_data.get("backtestData", [])
            previous_backtest = previous_data.get("backtestData", [])

            current_expected_map = {
                entry.get("date"): entry.get("expected")
                for entry in current_backtest
                if isinstance(entry, dict) and "expected" in entry
            }
            previous_expected_map = {
                entry.get("date"): entry.get("expected")
                for entry in previous_backtest
                if isinstance(entry, dict) and "expected" in entry
            }

            if current_expected_map != previous_expected_map:
                return True

        return False

    except Exception as e:
        print(f"[WARNING] {file_path} 처리 중 오류: {e}", file=sys.stderr)
        return False


def main():
    """메인 함수"""
    changed_files = get_changed_data_files()

    if not changed_files:
        print("[INFO] 변경된 data 파일이 없습니다.")
        # GitHub Actions output 설정 (새 방식)
        output_file = os.environ.get("GITHUB_OUTPUT")
        if output_file:
            with open(output_file, "a") as f:
                f.write("has_dividend_changes=false\n")
        # 구버전 호환성 (deprecated)
        print("::set-output name=has_dividend_changes::false")
        sys.exit(0)

    print(f"[INFO] 변경된 data 파일 {len(changed_files)}개 확인 중...")

    has_changes = False
    for file_path in changed_files:
        if check_file_changes(file_path):
            print(f"[CHANGED] {file_path}: 배당금 필드 변경 감지")
            has_changes = True

    if has_changes:
        print("[RESULT] 배당금 데이터 변경 감지됨")
        # GitHub Actions output 설정 (새 방식)
        output_file = os.environ.get("GITHUB_OUTPUT")
        if output_file:
            with open(output_file, "a") as f:
                f.write("has_dividend_changes=true\n")
        # 구버전 호환성 (deprecated)
        print("::set-output name=has_dividend_changes::true")
        sys.exit(0)
    else:
        print("[RESULT] 배당금 데이터 변경 없음")
        # GitHub Actions output 설정 (새 방식)
        output_file = os.environ.get("GITHUB_OUTPUT")
        if output_file:
            with open(output_file, "a") as f:
                f.write("has_dividend_changes=false\n")
        # 구버전 호환성 (deprecated)
        print("::set-output name=has_dividend_changes::false")
        sys.exit(0)


if __name__ == "__main__":
    main()
