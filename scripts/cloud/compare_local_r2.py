# scripts/compare_local_r2.py
"""
로컬과 R2 데이터 빠른 비교 스크립트

파일명과 파일크기만 비교하여 빠르게 차이점을 확인합니다.
MD5 해시 계산 없이 빠른 비교가 가능합니다.

사용법:
  python scripts/compare_local_r2.py
"""
import os
from pathlib import Path
from collections import defaultdict
from r2_helper import (
    get_r2_client,
    R2_AVAILABLE,
    upload_file_to_r2,
    delete_r2_files,
)


def get_r2_files_with_size(prefix=""):
    """
    R2 버킷에서 파일 목록과 크기 가져오기

    Args:
        prefix: 검색할 접두사 (예: 'data/')

    Returns:
        dict: {파일키: 파일크기}
    """
    try:
        s3_client, bucket_name = get_r2_client()

        if not s3_client or not bucket_name:
            print("[WARNING] R2 클라이언트를 초기화할 수 없습니다.")
            return {}

        print(f"[INFO] R2에서 '{prefix}' 파일 목록 조회 중...")

        files = {}
        paginator = s3_client.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            if "Contents" in page:
                for obj in page["Contents"]:
                    key = obj["Key"]
                    size = obj.get("Size", 0)
                    files[key] = size

        print(f"[OK] R2에 {len(files)}개 파일 발견")
        return files

    except Exception as e:
        print(f"[ERROR] R2 파일 목록 조회 실패: {e}")
        return {}


def get_local_files_with_size(local_dir, file_pattern="*.json"):
    """
    로컬 디렉토리의 파일 목록과 크기 가져오기

    Args:
        local_dir: 로컬 디렉토리 경로
        file_pattern: 파일 패턴 (기본값: "*.json", "*"는 모든 파일)

    Returns:
        dict: {r2_key: {"path": local_file_path, "size": file_size}}
    """
    local_path = Path(local_dir)
    if not local_path.exists():
        print(f"[ERROR] 디렉토리를 찾을 수 없습니다: {local_dir}")
        return {}

    files = {}

    # 모든 파일을 찾을지, 특정 패턴만 찾을지 결정
    if file_pattern == "*":
        file_list = local_path.rglob("*")
        file_list = [f for f in file_list if f.is_file()]
    else:
        file_list = local_path.rglob(file_pattern)

    for file_path in file_list:
        # R2 키 생성
        path_str = str(file_path).replace("\\", "/")

        if "public/" in path_str:
            r2_key = path_str.split("public/", 1)[1]
        else:
            r2_key = file_path.name

        # 파일 크기만 수집 (빠른 비교)
        file_size = file_path.stat().st_size
        files[r2_key] = {"path": str(file_path), "size": file_size}

    print(f"[OK] 로컬에 {len(files)}개 파일 발견")
    return files


def format_size(size_bytes):
    """파일 크기를 읽기 쉬운 형식으로 변환"""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


COMPARE_TARGETS = [
    ("data", "data/", "public/data", "*.json"),
    ("sidebar", "sidebar/", "public/sidebar", "*.json"),
    ("calendar", "calendar/", "public/calendar", "*.json"),
    ("logos", "logos/", "public/logos", "*"),
    ("nav", "", "public/nav.json", None),
]


def compare_and_show_diff(target_names=None):
    """로컬과 R2 비교 및 차이점 표시"""
    print("=" * 70)
    print("  로컬 ↔ R2 빠른 비교 (파일명 + 파일크기)")
    print("=" * 70)

    if not R2_AVAILABLE:
        print("[WARNING] boto3가 설치되지 않았습니다.")
        return

    if target_names:
        target_names = {name.strip().lower() for name in target_names}
        invalid = target_names.difference({name for name, *_ in COMPARE_TARGETS})
        if invalid:
            print(f"[ERROR] 알 수 없는 비교 대상: {', '.join(sorted(invalid))}")
            print("가능한 대상:", ", ".join(name for name, *_ in COMPARE_TARGETS))
            return

    all_diffs = []
    r2_only_files = []
    total_missing = 0
    total_changed = 0
    total_extra = 0

    # 1. 폴더 단위 비교
    for target_name, r2_prefix, local_path, pattern in COMPARE_TARGETS:
        if target_names and target_name not in target_names:
            continue

        if pattern is None:
            # 단일 파일 처리
            if not os.path.exists(local_path):
                continue

            file_name = Path(local_path).name
            # public/ 경로를 제거하고 R2 키 생성
            path_str = str(local_path).replace("\\", "/")
            if "public/" in path_str:
                r2_key = path_str.split("public/", 1)[1]
            else:
                r2_key = file_name if r2_prefix == "" else f"{r2_prefix}{file_name}"

            print(f"\n[비교] {file_name}")
            print("-" * 70)

            # R2 파일 목록 조회 (전체 목록에서 해당 키 찾기)
            r2_files = get_r2_files_with_size("")  # 전체 목록 조회
            local_size = Path(local_path).stat().st_size

            if r2_key not in r2_files:
                print(f"  ❌ 누락: {r2_key} (로컬: {format_size(local_size)})")
                all_diffs.append(
                    {
                        "type": "missing",
                        "r2_key": r2_key,
                        "local_path": local_path,
                        "local_size": local_size,
                        "r2_size": None,
                    }
                )
                total_missing += 1
            elif r2_files[r2_key] != local_size:
                print(f"  ⚠️  크기 불일치: {r2_key}")
                print(f"      로컬: {format_size(local_size)}")
                print(f"      R2:   {format_size(r2_files[r2_key])}")
                all_diffs.append(
                    {
                        "type": "changed",
                        "r2_key": r2_key,
                        "local_path": local_path,
                        "local_size": local_size,
                        "r2_size": r2_files[r2_key],
                    }
                )
                total_changed += 1
            else:
                print(f"  ✅ 동일 ({format_size(local_size)})")

        else:
            # 폴더 처리
            if not os.path.exists(local_path):
                print(f"\n[비교] {r2_prefix} (로컬 폴더 없음)")
                continue

            display_name = r2_prefix or target_name
            print(f"\n[비교] {display_name}")
            print("-" * 70)

            # R2 파일 목록 조회
            r2_files = get_r2_files_with_size(r2_prefix)
            local_files = get_local_files_with_size(local_path, pattern)

            # 로컬에만 있는 파일 (누락)
            # local_files의 r2_key는 이미 전체 경로를 포함 (예: data/xxx.json)
            folder_missing = 0
            folder_changed = 0

            for r2_key, file_info in local_files.items():
                local_size = file_info["size"]

                # r2_key가 이미 전체 경로를 포함하므로 r2_prefix를 다시 붙이지 않음
                if r2_key not in r2_files:
                    print(f"  ❌ 누락: {r2_key} ({format_size(local_size)})")
                    all_diffs.append(
                        {
                            "type": "missing",
                            "r2_key": r2_key,
                            "local_path": file_info["path"],
                            "local_size": local_size,
                            "r2_size": None,
                        }
                    )
                    total_missing += 1
                    folder_missing += 1
                elif r2_files[r2_key] != local_size:
                    print(f"  ⚠️  크기 불일치: {r2_key}")
                    print(f"      로컬: {format_size(local_size)}")
                    print(f"      R2:   {format_size(r2_files[r2_key])}")
                    all_diffs.append(
                        {
                            "type": "changed",
                            "r2_key": r2_key,
                            "local_path": file_info["path"],
                            "local_size": local_size,
                            "r2_size": r2_files[r2_key],
                        }
                    )
                    total_changed += 1
                    folder_changed += 1

            # 폴더 요약 출력 (불일치가 없으면 표시)
            if folder_missing == 0 and folder_changed == 0:
                print(f"  ✅ 모든 파일 동일 ({len(local_files)}개)")

            # R2에만 있는 파일 (추가)
            local_keys = {k: v for k, v in local_files.items()}
            for r2_key, r2_size in r2_files.items():
                if r2_key not in local_keys:
                    print(f"  ℹ️  R2에만 존재: {r2_key} ({format_size(r2_size)})")
                    total_extra += 1
                    r2_only_files.append(
                        {"r2_key": r2_key, "r2_size": r2_size, "prefix": r2_prefix}
                    )

    # 요약
    print("\n" + "=" * 70)
    print("  비교 결과 요약")
    print("=" * 70)
    print(f"  누락된 파일: {total_missing}개")
    print(f"  크기 불일치: {total_changed}개")
    print(f"  R2에만 존재: {total_extra}개")
    print(f"  총 차이: {total_missing + total_changed}개")

    # 후속 조치 제공
    if all_diffs or r2_only_files:
        print("\n" + "=" * 70)
        print("  후속 조치")
        print("=" * 70)

        missing_files = [d for d in all_diffs if d["type"] == "missing"]
        changed_files = [d for d in all_diffs if d["type"] == "changed"]

        if missing_files:
            print(f"\n[누락된 파일] ({len(missing_files)}개)")
            for i, diff in enumerate(missing_files, 1):
                print(f"  {i}. {diff['r2_key']} ({format_size(diff['local_size'])})")

        if changed_files:
            print(f"\n[크기 불일치 파일] ({len(changed_files)}개)")
            for i, diff in enumerate(changed_files, 1):
                print(f"  {i}. {diff['r2_key']}")
                print(
                    f"     로컬: {format_size(diff['local_size'])} → R2: {format_size(diff['r2_size'])})"
                )

        if r2_only_files:
            print(f"\n[R2 전용 파일] ({len(r2_only_files)}개)")
            for i, diff in enumerate(r2_only_files, 1):
                print(f"  {i}. {diff['r2_key']} ({format_size(diff['r2_size'])})")

        if all_diffs:
            print("\n" + "-" * 70)
            response = input(f"\n업로드할까요? (y/n): ").strip().lower()

            if response == "y":
                print("\n업로드 시작...")
                success_count = 0
                fail_count = 0

                for diff in all_diffs:
                    print(f"  업로드 중: {diff['r2_key']}...", end=" ")
                    if upload_file_to_r2(diff["local_path"], diff["r2_key"]):
                        print("✅")
                        success_count += 1
                    else:
                        print("❌")
                        fail_count += 1

                print(f"\n업로드 완료: 성공 {success_count}개, 실패 {fail_count}개")
            else:
                print("\n업로드를 건너뜁니다.")

        if r2_only_files:
            delete_response = (
                input("\nR2에만 있는 파일을 삭제할까요? (y/n): ").strip().lower()
            )
            if delete_response == "y":
                print("\n삭제 시작...")
                keys = [diff["r2_key"] for diff in r2_only_files]
                deleted, errors = delete_r2_files(keys)
                if deleted:
                    print(f"  ✅ 삭제 완료 ({len(deleted)}개)")
                    for key in deleted:
                        print(f"    - {key}")
                if errors:
                    print(f"  ❌ 삭제 실패 ({len(errors)}개)")
                    for key in errors:
                        print(f"    - {key}")
                if not deleted and not errors:
                    print("  ⚠️ 삭제할 파일이 없습니다.")
            else:
                print("\n삭제를 건너뜁니다.")
    else:
        print("\n✅ 로컬과 R2가 동기화되어 있습니다!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="로컬과 R2의 특정 폴더/파일을 빠르게 비교합니다."
    )
    parser.add_argument(
        "targets",
        nargs="*",
        help=(
            "비교할 대상 이름 (여러 개 지정 가능). "
            "가능한 값: " + ", ".join(name for name, *_ in COMPARE_TARGETS)
        ),
    )

    args = parser.parse_args()
    compare_and_show_diff(args.targets or None)
