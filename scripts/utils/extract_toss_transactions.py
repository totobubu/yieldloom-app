"""
토스 증권 거래내역서 PDF 추출 스크립트의 위치가 `api` 디렉터리로 옮겨졌습니다.
이 파일은 기존 경로 호환을 유지하기 위한 래퍼입니다.
"""

try:
    from api.toss_extractor import (  # type: ignore
        extract_ticker_code,
        extract_transactions_from_pdf,
        main as _main,
        parse_number,
        parse_transaction_lines,
        print_sample_transactions,
        print_statistics,
        save_to_json,
    )
except ImportError:  # pragma: no cover - 모듈을 직접 실행할 때 대비
    from toss_extractor import (  # type: ignore
        extract_ticker_code,
        extract_transactions_from_pdf,
        main as _main,
        parse_number,
        parse_transaction_lines,
        print_sample_transactions,
        print_statistics,
        save_to_json,
    )


def main():
    _main()


if __name__ == "__main__":
    main()
