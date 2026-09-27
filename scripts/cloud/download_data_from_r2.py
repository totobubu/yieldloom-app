# scripts/download_data_from_r2.py
"""
R2에서 public/data 파일을 다운로드하여 로컬 개발 환경 구축
"""
import os
import argparse
from pathlib import Path
from tqdm import tqdm
from r2_helper import (
    download_file_from_r2,
    list_r2_files,
    R2_AVAILABLE,
    load_r2_config,
)


def download_data_files(filter_tickers=None, force=False):
    """
    R2에서 public/data 파일들을 다운로드

    Args:
        filter_tickers: 다운로드할 티커 리스트 (None이면 전체 다운로드)
        force: 이미 존재하는 파일도 강제로 다시 다운로드
    """
    if not R2_AVAILABLE:
        print("[ERROR] boto3가 설치되지 않았습니다.")
        print("다음 명령어로 설치하세요: pip install boto3")
        return

    try:
        config = load_r2_config()
        print(f"[OK] R2 버킷: {config['bucket_name']}")
        print(f"[OK] Public URL: {config['public_url']}\n")
    except Exception as e:
        print(f"[ERROR] R2 설정을 로드할 수 없습니다: {e}")
        print("환경변수 또는 .env.r2 파일을 확인하세요.")
        return

    # R2에서 data/ 폴더의 파일 목록 가져오기
    print("[INFO] R2에서 파일 목록 조회 중...")
    r2_files = list_r2_files("data/")

    if not r2_files:
        print("[WARNING] R2에 data/ 파일이 없습니다.")
        return

    print(f"[OK] R2에서 {len(r2_files)}개 파일 발견\n")

    # 필터링 적용
    if filter_tickers:
        # 티커 리스트를 파일명으로 변환 (예: "005930" -> "005930-ks.json")
        filter_set = set()
        for ticker in filter_tickers:
            # 다양한 형식 지원
            if not ticker.endswith(".json"):
                # 티커만 제공된 경우, 가능한 모든 조합 시도
                filter_set.add(f"{ticker}-ks.json")
                filter_set.add(f"{ticker}-kq.json")
                filter_set.add(f"{ticker}-us.json")
            else:
                filter_set.add(ticker)

        r2_files = [f for f in r2_files if any(f.endswith(ft) for ft in filter_set)]
        print(f"[INFO] 필터링 후 {len(r2_files)}개 파일 선택\n")

    # 다운로드 진행
    local_data_dir = Path("public/data")
    local_data_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    skip_count = 0
    fail_count = 0

    print(f"[INFO] 다운로드 시작 ({len(r2_files)}개 파일)...\n")

    for r2_key in tqdm(r2_files, desc="Downloading files"):
        # 로컬 파일 경로 생성
        filename = r2_key.split("/")[-1]  # data/005930-ks.json -> 005930-ks.json
        local_file_path = local_data_dir / filename

        # 이미 존재하고 force가 아니면 스킵
        if local_file_path.exists() and not force:
            skip_count += 1
            continue

        # 다운로드
        if download_file_from_r2(r2_key, local_file_path):
            success_count += 1
        else:
            fail_count += 1
            tqdm.write(f"[FAIL] {filename}")

    # 결과 출력
    print("\n" + "=" * 60)
    print("  다운로드 완료!")
    print("=" * 60)
    print(f"  성공: {success_count}개")
    print(f"  스킵: {skip_count}개 (이미 존재)")
    print(f"  실패: {fail_count}개")
    print(f"\n로컬 경로: {local_data_dir.absolute()}")


def main():
    parser = argparse.ArgumentParser(
        description="R2에서 public/data 파일을 다운로드"
    )
    parser.add_argument(
        "--tickers",
        nargs="+",
        help="다운로드할 티커 리스트 (예: --tickers 005930 207940 AAPL)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="이미 존재하는 파일도 강제로 다시 다운로드",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="다운로드 전에 public/data 폴더 비우기",
    )

    args = parser.parse_args()

    # 폴더 비우기
    if args.clear:
        local_data_dir = Path("public/data")
        if local_data_dir.exists():
            print(f"[INFO] {local_data_dir} 폴더 내용 삭제 중...")
            for file in local_data_dir.glob("*.json"):
                file.unlink()
            print("[OK] 폴더 비우기 완료\n")

    # 다운로드 실행
    download_data_files(filter_tickers=args.tickers, force=args.force)


if __name__ == "__main__":
    main()

