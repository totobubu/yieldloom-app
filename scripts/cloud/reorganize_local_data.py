#!/usr/bin/env python3
"""
로컬 public/data 파일들을 market별 하위 폴더로 재분류

R2의 구조에 맞춰 로컬 파일들을 재구성합니다:
- data/kosdaq/
- data/kospi/
- data/nasdaq/
- data/nyse/
- data/bats/
- data/misc/ (market 정보 없는 파일)

사용법:
  python scripts/cloud/reorganize_local_data.py [--dry-run]
"""
import json
import shutil
from pathlib import Path
from collections import defaultdict
import argparse


# Market -> 폴더명 매핑
MARKET_TO_FOLDER = {
    'KOSDAQ': 'kosdaq',
    'KOSPI': 'kospi',
    'NASDAQ': 'nasdaq',
    'NYSE': 'nyse',
    'BATS': 'bats',
}

# 특수 파일 처리 (market 정보가 없는 파일들)
SPECIAL_FILES = {
    'failed_dividend_symbols.json': None,  # data/ 루트에 유지
    'dia.json': 'misc',
    'qqq.json': 'misc',
    'spy.json': 'misc',
}


def get_market_from_file(file_path):
    """
    JSON 파일에서 market 정보 읽기

    Returns:
        str: market 이름 (대문자) 또는 None
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        market = data.get('tickerInfo', {}).get('market')
        if market:
            return market.upper()
        return None
    except Exception as e:
        print(f"[ERROR] 파일 읽기 실패 ({file_path.name}): {e}")
        return None


def reorganize_files(data_dir, dry_run=False):
    """
    파일들을 market별 폴더로 재구성

    Args:
        data_dir: public/data 디렉토리 경로
        dry_run: True면 실제 이동 없이 시뮬레이션만
    """
    data_path = Path(data_dir)

    if not data_path.exists():
        print(f"[ERROR] 디렉토리를 찾을 수 없습니다: {data_dir}")
        return

    # 현재 루트에 있는 모든 JSON 파일
    files = list(data_path.glob('*.json'))

    if not files:
        print("[INFO] 재구성할 파일이 없습니다.")
        return

    print(f"{'[DRY RUN] ' if dry_run else ''}총 {len(files)}개 파일 재구성 시작...\n")

    # 통계
    stats = defaultdict(int)
    errors = []

    # 1단계: 파일 분류
    print("=" * 70)
    print("1단계: 파일 분석 및 분류")
    print("=" * 70)

    file_moves = []  # (source, target_folder, filename)

    for i, file_path in enumerate(files, 1):
        if i % 500 == 0:
            print(f"  진행: {i}/{len(files)}...")

        filename = file_path.name

        # 특수 파일 처리
        if filename in SPECIAL_FILES:
            target_folder = SPECIAL_FILES[filename]
            if target_folder is None:
                # 루트에 유지
                stats['루트 유지'] += 1
                continue
            else:
                file_moves.append((file_path, target_folder, filename))
                stats[target_folder] += 1
                continue

        # Market 정보로 분류
        market = get_market_from_file(file_path)

        if market and market in MARKET_TO_FOLDER:
            target_folder = MARKET_TO_FOLDER[market]
            file_moves.append((file_path, target_folder, filename))
            stats[target_folder] += 1
        else:
            # Market 정보가 없거나 매핑되지 않은 경우 -> misc
            file_moves.append((file_path, 'misc', filename))
            stats['misc'] += 1
            if market:
                print(f"  [WARNING] 알 수 없는 market: {market} ({filename})")
            else:
                print(f"  [INFO] Market 정보 없음 -> misc: {filename}")

    # 통계 출력
    print(f"\n분류 완료!")
    print("\n" + "=" * 70)
    print("분류 결과")
    print("=" * 70)
    for folder in sorted(stats.keys()):
        print(f"  {folder:15s}: {stats[folder]:5d}개 파일")
    print(f"\n  총 이동할 파일: {len(file_moves)}개")

    if not file_moves:
        print("\n[INFO] 이동할 파일이 없습니다.")
        return

    # 2단계: 폴더 생성
    if not dry_run:
        print("\n" + "=" * 70)
        print("2단계: 하위 폴더 생성")
        print("=" * 70)

        folders_to_create = set(folder for _, folder, _ in file_moves)
        for folder in sorted(folders_to_create):
            folder_path = data_path / folder
            folder_path.mkdir(exist_ok=True)
            print(f"  ✓ {folder_path}")

    # 3단계: 파일 이동
    print("\n" + "=" * 70)
    print(f"3단계: 파일 이동 {'(시뮬레이션)' if dry_run else ''}")
    print("=" * 70)

    moved = 0
    failed = 0

    for source, target_folder, filename in file_moves:
        target_path = data_path / target_folder / filename

        try:
            if not dry_run:
                shutil.move(str(source), str(target_path))
            moved += 1

            if moved <= 10 or moved % 500 == 0:
                action = "→" if dry_run else "✓"
                print(f"  {action} {filename:40s} -> {target_folder}/")
        except Exception as e:
            failed += 1
            errors.append((filename, str(e)))
            print(f"  ✗ {filename}: {e}")

    # 최종 결과
    print("\n" + "=" * 70)
    print("재구성 완료!")
    print("=" * 70)
    print(f"  성공: {moved:5d}개")
    print(f"  실패: {failed:5d}개")

    if errors:
        print("\n오류 목록:")
        for filename, error in errors:
            print(f"  - {filename}: {error}")

    if not dry_run:
        print(f"\n재구성된 폴더: {data_path.absolute()}")
        print("\n다음 폴더 구조가 생성되었습니다:")
        for folder in sorted(stats.keys()):
            if folder != '루트 유지':
                print(f"  - {data_path / folder}")


def main():
    parser = argparse.ArgumentParser(
        description="로컬 파일을 market별 하위 폴더로 재구성"
    )
    parser.add_argument(
        "--data-dir",
        default="public/data",
        help="데이터 디렉토리 경로 (기본값: public/data)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="실제 이동 없이 시뮬레이션만 실행"
    )

    args = parser.parse_args()

    if args.dry_run:
        print("\n⚠️  DRY RUN 모드: 실제 파일 이동 없이 시뮬레이션만 실행됩니다.\n")

    reorganize_files(args.data_dir, dry_run=args.dry_run)

    if args.dry_run:
        print("\n실제 재구성을 수행하려면 --dry-run 없이 실행하세요:")
        print(f"  python scripts/cloud/reorganize_local_data.py")


if __name__ == "__main__":
    main()
