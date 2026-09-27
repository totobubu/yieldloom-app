"""
토스 증권 거래내역서 PDF에서 거래 데이터 추출 모듈.
기존 `scripts/extract_toss_transactions.py`와 동일한 기능을 제공하지만
서버리스 함수 번들에 포함되도록 api 디렉터리로 위치를 옮겼습니다.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pdfplumber


def parse_number(text):
    """숫자 텍스트를 파싱 (쉼표 제거 후 float 변환)"""
    if not text or text == "0":
        return 0
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return 0


def extract_ticker_code(text):
    """텍스트에서 US로 시작하는 종목코드 추출"""
    match = re.search(r"(US[A-Z0-9]{8,12})", text)
    if match:
        return match.group(1)
    return None


def parse_transaction_lines(lines, start_idx):
    """
    주어진 시작 위치부터 하나의 거래 데이터를 파싱

    Returns: (transaction_dict, next_idx) 또는 (None, start_idx + 1)
    """

    if start_idx >= len(lines):
        return None, start_idx + 1

    line1 = lines[start_idx].strip()

    # 빈 줄이거나 헤더 줄 스킵
    if not line1 or "거래일자" in line1 or "거래구분" in line1:
        return None, start_idx + 1

    # 날짜로 시작하는지 확인 (YYYY.MM.DD 형식)
    if not re.match(r"^\d{4}\.\d{2}\.\d{2}", line1):
        return None, start_idx + 1

    # 전체 텍스트를 합치기 (여러 줄에 걸쳐 있을 수 있음)
    full_text = line1
    next_idx = start_idx + 1

    # 다음 줄이 날짜로 시작하지 않으면 계속 붙이기 (최대 3줄)
    for _ in range(2):
        if next_idx < len(lines):
            next_line = lines[next_idx].strip()
            if next_line and not re.match(r"^\d{4}\.\d{2}\.\d{2}", next_line):
                full_text += " " + next_line
                next_idx += 1
            else:
                break

    try:
        # 종목코드 추출
        ticker = extract_ticker_code(full_text)

        # 날짜 추출
        date_match = re.match(r"^(\d{4}\.\d{2}\.\d{2})", full_text)
        if not date_match:
            return None, next_idx
        trade_date = date_match.group(1)

        # 거래구분 추출 (날짜 바로 다음)
        type_match = re.search(r"\d{4}\.\d{2}\.\d{2}\s+(\S+)", full_text)
        if not type_match:
            return None, next_idx
        trade_type = type_match.group(1)

        # 종목코드 제거하고 종목명 추출
        temp_text = full_text
        if ticker:
            temp_text = temp_text.replace(f"({ticker})", "").replace(ticker, "")

        # 환율 패턴 찾기: 1,392.00 같은 형식
        exchange_rate_pattern = r"\s+(\d{1,2},\d{3}\.\d{2})\s+"
        exchange_rate_match = re.search(exchange_rate_pattern, temp_text)

        if not exchange_rate_match:
            return None, next_idx

        exchange_rate = parse_number(exchange_rate_match.group(1))

        # 종목명: 거래구분과 환율 사이
        stock_name_pattern = r"\d{4}\.\d{2}\.\d{2}\s+\S+\s+(.+?)\s+\d{1,2},\d{3}\.\d{2}"
        stock_name_match = re.search(stock_name_pattern, temp_text)

        if not stock_name_match:
            return None, next_idx

        stock_name = stock_name_match.group(1).strip()
        stock_name = re.sub(r"\s+ETF\s*", " ETF ", stock_name).strip()

        # 환율 이후의 숫자들 추출
        after_rate = temp_text[exchange_rate_match.end() :]

        # 괄호 안의 달러 값은 제외
        numbers_text = re.sub(r"\([^)]*\)", "", after_rate)

        # 모든 숫자 추출
        number_pattern = r"[\d,]+\.?\d*"
        numbers = re.findall(number_pattern, numbers_text)

        if len(numbers) < 8:
            return None, next_idx

        quantity = parse_number(numbers[0])
        transaction_amount_krw = parse_number(numbers[1])
        unit_price_krw = parse_number(numbers[2])
        commission_krw = parse_number(numbers[3])
        tax_krw = parse_number(numbers[4])
        delinquency_krw = parse_number(numbers[5])
        balance_quantity = parse_number(numbers[6])
        balance_krw = parse_number(numbers[7])

        # 달러 값 추출 (괄호 안의 $ 값들)
        dollar_pattern = r"\(\$\s*([\d,.-]+)\)"
        dollar_matches = re.findall(dollar_pattern, full_text)

        dollar_values = {}
        if len(dollar_matches) >= 6:
            dollar_values = {
                "unit_price_usd": parse_number(dollar_matches[0]),
                "transaction_amount_usd": parse_number(dollar_matches[1]),
                "commission_usd": parse_number(dollar_matches[2]),
                "tax_usd": parse_number(dollar_matches[3]),
                "delinquency_usd": parse_number(dollar_matches[4]),
                "balance_usd": parse_number(dollar_matches[5]),
            }
        elif len(dollar_matches) >= 1:
            if len(dollar_matches) >= 1:
                dollar_values["unit_price_usd"] = parse_number(dollar_matches[0])
            if len(dollar_matches) >= 2:
                dollar_values["transaction_amount_usd"] = parse_number(
                    dollar_matches[1]
                )
            if len(dollar_matches) >= 3:
                dollar_values["commission_usd"] = parse_number(dollar_matches[2])
            if len(dollar_matches) >= 4:
                dollar_values["tax_usd"] = parse_number(dollar_matches[3])
            if len(dollar_matches) >= 5:
                dollar_values["delinquency_usd"] = parse_number(dollar_matches[4])
            if len(dollar_matches) >= 6:
                dollar_values["balance_usd"] = parse_number(dollar_matches[5])

        transaction = {
            "date": trade_date,
            "type": trade_type,
            "stock_name": stock_name,
            "ticker": ticker,
            "exchange_rate": exchange_rate,
            "quantity": quantity,
            "transaction_amount_krw": transaction_amount_krw,
            "unit_price_krw": unit_price_krw,
            "commission_krw": commission_krw,
            "tax_krw": tax_krw,
            "delinquency_krw": delinquency_krw,
            "balance_quantity": balance_quantity,
            "balance_krw": balance_krw,
            **dollar_values,
        }

        return transaction, next_idx

    except (IndexError, ValueError, AttributeError):
        return None, next_idx


def extract_transactions_from_pdf(pdf_path, verbose=True):
    """PDF에서 모든 거래 데이터 추출"""

    transactions = []
    metadata = {}

    if verbose:
        print(f"\n{'=' * 80}", file=sys.stderr)
        print(f"📄 거래내역서 데이터 추출 중: {pdf_path}", file=sys.stderr)
        print(f"{'=' * 80}\n", file=sys.stderr)
    else:
        print(f"[extractor] 시작: pdf_path={pdf_path}", file=sys.stderr)

    with pdfplumber.open(pdf_path) as pdf:
        if verbose:
            print(f"총 페이지 수: {len(pdf.pages)}", file=sys.stderr)

        for page_num, page in enumerate(pdf.pages, 1):
            text = page.extract_text()
            if not text:
                continue

            lines = text.split("\n")

            # 첫 페이지에서 메타데이터 추출
            if page_num == 1:
                for line in lines:
                    if not verbose:
                        print(
                            f"[extractor] metadata 후보 line: {line}",
                            file=sys.stderr,
                        )
                    if "발급번호" in line:
                        parts = line.split("발급번호")
                        if len(parts) > 1:
                            metadata["issue_number"] = parts[1].strip()
                    elif "성명" in line and "종목" not in line:
                        match = re.search(r"성명\s+(\S+)", line)
                        if match:
                            metadata["customer_name"] = match.group(1)
                    elif "계좌" in line and "번호" in line:
                        match = re.search(r"(\d{3}-\d{2}-\d{6})", line)
                        if match:
                            metadata["account_number"] = match.group(1)
                    elif "조회 기간" in line:
                        parts = line.split("조회 기간")
                        if len(parts) > 1:
                            metadata["period"] = parts[1].strip()

            i = 0
            while i < len(lines):
                transaction, next_i = parse_transaction_lines(lines, i)
                if transaction:
                    if not verbose:
                        print(
                            f"[extractor] 거래 추출: {transaction}",
                            file=sys.stderr,
                        )
                    transactions.append(transaction)
                i = next_i

            if verbose and (page_num % 10 == 0 or page_num == len(pdf.pages)):
                print(
                    f"  진행: {page_num}/{len(pdf.pages)} 페이지, 추출된 거래: {len(transactions)}건",
                    file=sys.stderr,
                )

    if verbose:
        print(f"\n✅ 추출 완료!", file=sys.stderr)
        print(f"  총 거래 건수: {len(transactions)}건", file=sys.stderr)

    return {
        "metadata": metadata,
        "transactions": transactions,
        "total_count": len(transactions),
        "extracted_at": datetime.now().isoformat(),
    }


def save_to_json(data, output_path):
    """추출한 데이터를 JSON 파일로 저장"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"\n💾 데이터가 저장되었습니다: {output_path}")


def print_statistics(data):
    """거래 통계 출력"""
    transactions = data["transactions"]

    if not transactions:
        print("\n⚠️  추출된 거래가 없습니다.")
        return

    print(f"\n{'=' * 80}")
    print("📊 거래 통계")
    print(f"{'=' * 80}")

    stock_stats = {}
    for t in transactions:
        ticker = t.get("ticker", "Unknown")
        if ticker not in stock_stats:
            stock_stats[ticker] = {
                "name": t.get("stock_name", ""),
                "count": 0,
                "total_amount_krw": 0,
                "total_quantity": 0,
            }
        stock_stats[ticker]["count"] += 1
        stock_stats[ticker]["total_amount_krw"] += t.get("transaction_amount_krw", 0)
        stock_stats[ticker]["total_quantity"] += t.get("quantity", 0)

    print(f"\n종목별 거래 통계 (총 {len(stock_stats)}개 종목):")
    print(f"{'─' * 80}")

    sorted_stocks = sorted(
        stock_stats.items(),
        key=lambda x: x[1]["total_amount_krw"],
        reverse=True,
    )

    for ticker, stats in sorted_stocks[:10]:
        print(f"  {ticker:20s} ({stats['name'][:30]:30s})")
        print(f"    거래 횟수: {stats['count']:4d}회")
        print(f"    총 거래금액: {stats['total_amount_krw']:,.0f}원")
        print(f"    총 수량: {stats['total_quantity']:.2f}")
        print()

    if len(sorted_stocks) > 10:
        print(f"  ... 외 {len(sorted_stocks) - 10}개 종목")

    dates = [t["date"] for t in transactions if t.get("date")]
    if dates:
        print(f"\n거래 기간: {min(dates)} ~ {max(dates)}")

    total_amount = sum(t.get("transaction_amount_krw", 0) for t in transactions)
    total_commission = sum(t.get("commission_krw", 0) for t in transactions)
    print(f"총 거래금액: {total_amount:,.0f}원")
    print(f"총 수수료: {total_commission:,.0f}원")


def print_sample_transactions(data, count=5):
    """샘플 거래 출력"""
    transactions = data["transactions"]

    if not transactions:
        return

    print(f"\n{'=' * 80}")
    print(f"📝 샘플 거래 (최근 {min(count, len(transactions))}건)")
    print(f"{'=' * 80}\n")

    for i, t in enumerate(transactions[:count], 1):
        print(f"거래 #{i}")
        print(f"  날짜: {t.get('date')}")
        print(f"  구분: {t.get('type')}")
        print(f"  종목: {t.get('stock_name')} ({t.get('ticker')})")
        print(f"  수량: {t.get('quantity')}")
        if t.get("unit_price_usd"):
            print(
                f"  단가: ${t.get('unit_price_usd'):.4f} (환율: {t.get('exchange_rate')})"
            )
        else:
            print(
                f"  단가: {t.get('unit_price_krw'):,.0f}원 (환율: {t.get('exchange_rate')})"
            )
        print(f"  거래금액: {t.get('transaction_amount_krw'):,.0f}원")
        if t.get("transaction_amount_usd"):
            print(f"           (${t.get('transaction_amount_usd'):.2f})")
        print()


def main():
    if len(sys.argv) > 1:
        pdf_path = Path(sys.argv[1])
        if not pdf_path.exists():
            error_result = {"error": "파일을 찾을 수 없습니다"}
            print(json.dumps(error_result, ensure_ascii=False))
            sys.exit(1)

        data = extract_transactions_from_pdf(pdf_path)
        print(json.dumps(data, ensure_ascii=False))
    else:
        pdf_path = Path("public/transactions/1761864827737.pdf")

        if not pdf_path.exists():
            print(f"❌ 파일을 찾을 수 없습니다: {pdf_path}")
            sys.exit(1)

        data = extract_transactions_from_pdf(pdf_path)
        print_statistics(data)
        print_sample_transactions(data, count=10)

        output_path = Path("public/transactions/toss_transactions.json")
        save_to_json(data, output_path)

        print(f"\n🎉 작업이 완료되었습니다!")


if __name__ == "__main__":
    main()

