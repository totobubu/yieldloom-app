import json
import os
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP, getcontext, InvalidOperation
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "public" / "data"

getcontext().prec = 28
DECIMAL_QUANT = Decimal("0.000001")


def parse_ratio(ratio_str):
    """
    yfinance split ratio 해석:
    - numerator:denominator 형식
    - 일반적으로 "numerator주를 denominator주로"를 의미
    - 하지만 yfinance는 때때로 반대로 저장할 수 있음

    예시:
    - 1:2 = 2주를 1주로 합침 (reverse split) → factor = 0.5 (또는 2로 나눔)
    - 2:1 = 1주를 2주로 분할 (forward split) → factor = 2 (또는 2로 곱함)

    실제 데이터를 기반으로 확인:
    - TSLY의 경우 2주가 1주로 합쳐짐
    - amountFixed: 0.9986 (합쳐진 후)
    - amountOriginal: 0.4993 (합쳐지기 전, 원하는 값)
    - 0.9986 / 0.4993 ≈ 2
    - 따라서 1:2는 factor = 0.5 (또는 1/2)여야 함

    yfinance의 numerator/denominator를 그대로 사용하면:
    - numerator / denominator = 1 / 2 = 0.5
    """
    if not ratio_str or ":" not in ratio_str:
        return None
    left, right = ratio_str.split(":", 1)
    try:
        numerator = Decimal(left.strip())
        denominator = Decimal(right.strip())
        if denominator == 0:
            return None
        # yfinance의 numerator:denominator는 "numerator/denominator" 비율을 의미
        # reverse split 1:2의 경우: 1/2 = 0.5 (2주를 1주로 합침)
        # forward split 2:1의 경우: 2/1 = 2 (1주를 2주로 분할)
        return numerator / denominator
    except (InvalidOperation, ValueError):
        return None


def load_splits(ticker_info):
    splits = (
        ticker_info.get("events", {}).get("splits", [])
        if isinstance(ticker_info, dict)
        else []
    )
    parsed = []
    for split in splits:
        date_str = split.get("date")
        ratio = split.get("ratio")
        factor = parse_ratio(ratio)
        if not date_str or factor is None:
            continue
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        parsed.append(
            {
                "date": date_obj,
                "ratio": ratio,
                "factor": factor,
            }
        )
    return sorted(parsed, key=lambda item: item["date"])


def apply_splits(base_value, entry_date, splits):
    if base_value is None or entry_date is None or not splits:
        return base_value, []

    try:
        current = Decimal(str(base_value))
    except (InvalidOperation, ValueError):
        return base_value, []

    adjustments = []

    for split in splits:
        if entry_date >= split["date"]:
            continue
        factor = split["factor"]
        if factor is None or factor == 0:
            continue
        current /= factor
        adjustments.append(
            {
                "date": split["date"].isoformat(),
                "ratio": split["ratio"],
                "factor": float(factor),
            }
        )

    if not adjustments:
        return base_value, []

    quantized = current.quantize(DECIMAL_QUANT, rounding=ROUND_HALF_UP)
    if quantized == quantized.to_integral_value():
        adjusted_value = int(quantized)
    else:
        adjusted_value = float(quantized)

    return adjusted_value, adjustments


def adjust_field(entry, field_name, entry_date, splits):
    original_field = f"{field_name}Original"
    adjustments_field = f"{field_name}SplitAdjustments"

    if (
        entry.get(field_name) is None
        and entry.get(original_field) is None
        and entry.get(adjustments_field) is None
    ):
        return False

    base_value = entry.get(original_field, entry.get(field_name))
    if base_value is None:
        return False

    adjusted_value, adjustments = apply_splits(base_value, entry_date, splits)
    changed = False

    if adjustments:
        if original_field not in entry or entry[original_field] != base_value:
            entry[original_field] = base_value
            changed = True
        if entry.get(field_name) != adjusted_value:
            entry[field_name] = adjusted_value
            changed = True
        if entry.get(adjustments_field) != adjustments:
            entry[adjustments_field] = adjustments
            changed = True
    else:
        # No applicable splits; ensure metadata is removed and field reflects base value
        if entry.get(field_name) != base_value:
            entry[field_name] = base_value
            changed = True
        if original_field in entry:
            entry.pop(original_field, None)
            changed = True
        if adjustments_field in entry:
            entry.pop(adjustments_field, None)
            changed = True

    return changed


def calculate_original_from_adjusted(adjusted_value, entry_date, splits):
    """
    조정된 값(adjusted_value)을 split 이전 원래 값으로 역산
    """
    if adjusted_value is None or entry_date is None or not splits:
        return adjusted_value, []

    try:
        current = Decimal(str(adjusted_value))
    except (InvalidOperation, ValueError):
        return adjusted_value, []

    adjustments = []

    # entry_date 이후의 split들을 역순으로 적용하여 원래 값 계산
    applicable_splits = [s for s in splits if entry_date < s["date"]]

    if not applicable_splits:
        return adjusted_value, []

    # 역순으로 factor를 곱해서 원래 값 계산
    for split in reversed(applicable_splits):
        factor = split["factor"]
        if factor is None or factor == 0:
            continue
        current *= factor
        adjustments.insert(
            0,
            {
                "date": split["date"].isoformat(),
                "ratio": split["ratio"],
                "factor": float(factor),
            },
        )

    quantized = current.quantize(DECIMAL_QUANT, rounding=ROUND_HALF_UP)
    if quantized == quantized.to_integral_value():
        original_value = int(quantized)
    else:
        original_value = float(quantized)

    return original_value, adjustments


def adjust_amount_with_split_priority(entry, entry_date, splits):
    """
    split이 있는 배당 데이터 처리:
    1. amountFixed가 있으면: amountFixed 기반으로 amountOriginal 계산
    2. amountFixed가 없으면: amount 기반으로 amountOriginal 계산

    amountFixedOriginal과 amountFixedSplitAdjustments는 생성하지 않음
    """
    if not splits:
        return False

    changed = False

    # amountFixed가 있으면 amountFixed 기반으로 amountOriginal 계산
    # amountFixed가 없으면 amount 기반으로 amountOriginal 계산
    base_field = "amountFixed" if entry.get("amountFixed") is not None else "amount"
    base_value = entry.get(base_field)

    if base_value is None:
        return False

    # base_value는 이미 split 조정된 값이므로, 역으로 계산하여 원래 값 구함
    original_value, adjustments = calculate_original_from_adjusted(
        base_value, entry_date, splits
    )

    # 항상 변경 처리 (기존 값과 비교하지 않고 재계산)
    if adjustments:
        # amountOriginal 설정 (항상 재계산)
        entry["amountOriginal"] = original_value
        changed = True

        # amountSplitAdjustments 설정 (항상 재계산)
        entry["amountSplitAdjustments"] = adjustments
        changed = True

        # amountFixedOriginal과 amountFixedSplitAdjustments 제거
        if "amountFixedOriginal" in entry:
            entry.pop("amountFixedOriginal", None)
            changed = True
        if "amountFixedSplitAdjustments" in entry:
            entry.pop("amountFixedSplitAdjustments", None)
            changed = True
    else:
        # split이 적용되지 않으면 amountOriginal 제거
        if "amountOriginal" in entry:
            entry.pop("amountOriginal", None)
            changed = True
        if "amountSplitAdjustments" in entry:
            entry.pop("amountSplitAdjustments", None)
            changed = True
        if "amountFixedOriginal" in entry:
            entry.pop("amountFixedOriginal", None)
            changed = True
        if "amountFixedSplitAdjustments" in entry:
            entry.pop("amountFixedSplitAdjustments", None)
            changed = True

    return changed


def process_file(json_path):
    with json_path.open(encoding="utf-8") as f:
        data = json.load(f)

    ticker_info = data.get("tickerInfo", {})
    splits = load_splits(ticker_info)
    if not splits:
        return False

    backtest = data.get("backtestData", [])
    file_changed = False
    updated_count = 0

    for entry in backtest:
        date_str = entry.get("date")
        try:
            entry_date = (
                datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else None
            )
        except ValueError:
            entry_date = None

        # split이 있는 경우: amountFixed 우선으로 amountOriginal 계산
        # amountFixedOriginal과 amountFixedSplitAdjustments는 생성하지 않음
        if splits:
            field_changed = adjust_amount_with_split_priority(entry, entry_date, splits)
            if field_changed:
                file_changed = True
                updated_count += 1
        else:
            # split이 없는 경우: 기존 로직 유지
            field_changed = False
            field_changed |= adjust_field(entry, "amount", entry_date, splits)
            field_changed |= adjust_field(entry, "amountFixed", entry_date, splits)
            if field_changed:
                file_changed = True
                updated_count += 1

    if file_changed:
        with json_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"[updated] {json_path.relative_to(BASE_DIR)} ({updated_count} entries)")

    return file_changed


def iter_market_files():
    if not DATA_DIR.exists():
        return []

    # MARKET_FILTER 환경 변수 확인 (KR만 처리)
    market_filter = os.environ.get("MARKET_FILTER", "").upper()
    kr_markets = {"kospi", "kosdaq", "konex"}

    for market_dir in DATA_DIR.iterdir():
        if not market_dir.is_dir():
            continue

        # MARKET_FILTER가 설정되어 있고 KR인 경우, 한국 마켓만 처리
        if market_filter == "KR":
            if market_dir.name.lower() not in kr_markets:
                continue

        for json_path in market_dir.glob("*.json"):
            yield json_path


def main():
    updated_files = 0
    for json_path in iter_market_files():
        if process_file(json_path):
            updated_files += 1
            print(f"[updated] {json_path.relative_to(BASE_DIR)}")
    print(f"완료: {updated_files}개 파일 업데이트")


if __name__ == "__main__":
    main()
