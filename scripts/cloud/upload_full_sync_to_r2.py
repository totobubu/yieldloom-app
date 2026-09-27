# scripts/upload_full_sync_to_r2.py
"""
R2 전체 동기화 스크립트 (수동 실행용)

⚠️ 주의: 이 스크립트는 워크플로우에서 사용하지 않습니다!
         일반적인 경우 upload_changed_to_r2.py를 사용하세요.

용도:
  1. 초기 전체 업로드 (새 프로젝트 또는 R2 초기화)
  2. R2-로컬 동기화 검증 및 복구
  3. Git 히스토리 없이 전체 동기화가 필요한 경우

작동 방식:
  - R2의 모든 파일 목록 조회 (느림)
  - 로컬의 모든 파일 MD5 해시 계산 (매우 느림)
  - 해시 비교 후 누락/변경된 파일 업로드

성능:
  - 소요 시간: 3-15분 (파일 수에 따라)
  - 일반적인 워크플로우에는 upload_changed_to_r2.py 사용 권장 (10배 빠름)

사용법:
  python scripts/upload_full_sync_to_r2.py
"""
import os
import argparse
import hashlib
from pathlib import Path
from tqdm import tqdm
from r2_helper import upload_file_to_r2, get_r2_client, load_r2_config, R2_AVAILABLE


def calculate_file_hash(file_path):
    """
    파일의 MD5 해시 계산 (R2의 ETag와 비교용)

    Args:
        file_path: 로컬 파일 경로

    Returns:
        str: MD5 해시 (소문자 hex)
    """
    md5_hash = hashlib.md5()
    try:
        with open(file_path, "rb") as f:
            # 메모리 효율을 위해 청크 단위로 읽기
            for chunk in iter(lambda: f.read(8192), b""):
                md5_hash.update(chunk)
        return md5_hash.hexdigest()
    except Exception as e:
        print(f"[ERROR] 파일 해시 계산 실패 ({file_path}): {e}")
        return None


def get_r2_files(prefix=""):
    """
    R2 버킷에서 파일 목록과 메타데이터 가져오기

    Args:
        prefix: 검색할 접두사 (예: 'data/')

    Returns:
        dict: {파일키: {"etag": ETag, "size": 파일크기}}
    """
    try:
        s3_client, bucket_name = get_r2_client()

        if not s3_client or not bucket_name:
            print(
                "[WARNING] R2 클라이언트를 초기화할 수 없습니다. R2 업로드를 건너뜁니다."
            )
            return {}

        print(f"[INFO] R2에서 '{prefix}' 파일 목록 조회 중...")

        files = {}
        paginator = s3_client.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            if "Contents" in page:
                for obj in page["Contents"]:
                    key = obj["Key"]
                    # ETag에서 따옴표 제거
                    etag = obj.get("ETag", "").strip('"')
                    size = obj.get("Size", 0)
                    files[key] = {"etag": etag, "size": size}

        print(f"[OK] R2에 {len(files)}개 파일 발견")
        return files

    except Exception as e:
        print(f"[ERROR] R2 파일 목록 조회 실패: {e}")
        return {}


def get_local_files(local_dir, file_pattern="*.json"):
    """
    로컬 디렉토리의 파일 목록과 해시 가져오기

    Args:
        local_dir: 로컬 디렉토리 경로
        file_pattern: 파일 패턴 (기본값: "*.json", "*"는 모든 파일)

    Returns:
        dict: {r2_key: {"path": local_file_path, "hash": md5_hash, "size": file_size}}
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

        # 파일 정보 수집
        file_hash = calculate_file_hash(str(file_path))
        file_size = file_path.stat().st_size

        files[r2_key] = {"path": str(file_path), "hash": file_hash, "size": file_size}

    print(f"[OK] 로컬에 {len(files)}개 파일 발견")
    return files


def upload_missing_files(target_sections):
    """누락되거나 변경된 파일 업로드"""
    print("=" * 60)
    print("  R2 동기화 스크립트 (누락/변경 파일 감지)")
    print("=" * 60)

    if not R2_AVAILABLE:
        print("[WARNING] boto3가 설치되지 않았습니다. R2 업로드를 건너뜁니다.")
        return

    try:
        config = load_r2_config()
        print(f"[OK] R2 버킷: {config['bucket_name']}")
        print(f"[OK] Public URL: {config['public_url']}\n")
    except Exception as e:
        print(f"[ERROR] R2 설정을 로드할 수 없습니다: {e}")
        return

    run_all = "all" in target_sections

    local_data_files = {}

    # 1. public/data 폴더 체크
    if run_all or "data" in target_sections:
        print("[1/6] public/data 폴더 비교 중...")
        r2_data_files = get_r2_files("data/")
        local_data_files = get_local_files("public/data")

        # 누락되거나 변경된 파일 찾기
        files_to_upload = []
        missing_count = 0
        changed_count = 0

        for r2_key, file_info in local_data_files.items():
            local_path = file_info["path"]
            local_hash = file_info["hash"]

            if r2_key not in r2_data_files:
                # 누락된 파일
                files_to_upload.append((r2_key, local_path, "missing"))
                missing_count += 1
            elif local_hash and r2_data_files[r2_key]["etag"] != local_hash:
                # 변경된 파일 (해시가 다름)
                files_to_upload.append((r2_key, local_path, "changed"))
                changed_count += 1

        print(f"[INFO] 누락된 파일: {missing_count}개")
        print(f"[INFO] 변경된 파일: {changed_count}개")
        print(f"[INFO] 업로드 대상: {len(files_to_upload)}개\n")

        # 파일 업로드
        if files_to_upload:
            success_count = 0
            fail_count = 0

            for r2_key, local_path, status in tqdm(
                files_to_upload, desc="Uploading files"
            ):
                if upload_file_to_r2(local_path, r2_key):
                    success_count += 1
                else:
                    fail_count += 1
                    tqdm.write(f"[FAIL] {r2_key}")

            print(f"\n   -> 성공: {success_count}, 실패: {fail_count}")
        else:
            print("   -> 업로드할 파일 없음")
    else:
        print("[1/6] public/data 폴더 비교 건너뜀 (요청 대상 아님)")

    # 2. nav.json 체크
    r2_files = None
    if run_all or "nav" in target_sections:
        print("\n[2/6] nav.json 확인 중...")
        r2_files = get_r2_files()

        if os.path.exists("public/nav.json"):
            local_nav_hash = calculate_file_hash("public/nav.json")

            if "nav.json" not in r2_files:
                print("   -> nav.json 누락 - 업로드 중...")
                if upload_file_to_r2("public/nav.json", "nav.json"):
                    print("   -> 성공")
                else:
                    print("   -> 실패")
            elif local_nav_hash and r2_files["nav.json"]["etag"] != local_nav_hash:
                print("   -> nav.json 변경됨 - 업로드 중...")
                if upload_file_to_r2("public/nav.json", "nav.json"):
                    print("   -> 성공")
                else:
                    print("   -> 실패")
            else:
                print("   -> 변경사항 없음")
        else:
            print("   -> 파일 없음")
    else:
        print("\n[2/6] nav.json 확인 건너뜀 (요청 대상 아님)")

    # 3. sidebar 폴더 체크
    if run_all or "sidebar" in target_sections:
        print("\n[3/6] sidebar 폴더 확인 중...")
        if os.path.exists("public/sidebar"):
            r2_sidebar_files = get_r2_files("sidebar/")
            local_sidebar_files = get_local_files("public/sidebar")

            sidebar_to_upload = []
            sidebar_missing = 0
            sidebar_changed = 0

            for r2_key, file_info in local_sidebar_files.items():
                local_path = file_info["path"]
                local_hash = file_info["hash"]

                if r2_key not in r2_sidebar_files:
                    sidebar_to_upload.append((r2_key, local_path, "missing"))
                    sidebar_missing += 1
                elif local_hash and r2_sidebar_files[r2_key]["etag"] != local_hash:
                    sidebar_to_upload.append((r2_key, local_path, "changed"))
                    sidebar_changed += 1

            if sidebar_to_upload:
                print(f"   -> 누락: {sidebar_missing}개, 변경: {sidebar_changed}개")
                success_sidebar = 0
                fail_sidebar = 0
                for r2_key, local_path, status in sidebar_to_upload:
                    if upload_file_to_r2(local_path, r2_key):
                        success_sidebar += 1
                        print(f"   -> {r2_key} ({status}) 업로드 성공")
                    else:
                        fail_sidebar += 1
                        print(f"   -> {r2_key} ({status}) 업로드 실패")
                print(f"   -> 성공: {success_sidebar}, 실패: {fail_sidebar}")
            else:
                print("   -> 변경사항 없음")
        else:
            print("   -> 폴더 없음")
    else:
        print("\n[3/6] sidebar 폴더 확인 건너뜀 (요청 대상 아님)")

    # 4. calendar-events.json 및 calendar 폴더 체크
    if run_all or "calendar" in target_sections:
        print("\n[4/6] calendar-events.json 및 calendar 폴더 확인 중...")

        # 4-1. calendar-events.json
        if os.path.exists("public/calendar-events.json"):
            if r2_files is None:
                r2_files = get_r2_files()
            local_calendar_hash = calculate_file_hash("public/calendar-events.json")

            if "calendar-events.json" not in r2_files:
                print("   -> calendar-events.json 누락 - 업로드 중...")
                if upload_file_to_r2(
                    "public/calendar-events.json", "calendar-events.json"
                ):
                    print("   -> 성공")
                else:
                    print("   -> 실패")
            elif (
                local_calendar_hash
                and r2_files["calendar-events.json"]["etag"] != local_calendar_hash
            ):
                print("   -> calendar-events.json 변경됨 - 업로드 중...")
                if upload_file_to_r2(
                    "public/calendar-events.json", "calendar-events.json"
                ):
                    print("   -> 성공")
                else:
                    print("   -> 실패")
            else:
                print("   -> 변경사항 없음")
        else:
            print("   -> calendar-events.json 파일 없음")

        # 4-2. calendar 폴더
        if os.path.exists("public/calendar"):
            r2_calendar_files = get_r2_files("calendar/")
            local_calendar_files = get_local_files("public/calendar", "*")  # 모든 파일

            calendar_to_upload = []
            calendar_missing = 0
            calendar_changed = 0

            for r2_key, file_info in local_calendar_files.items():
                local_path = file_info["path"]
                local_hash = file_info["hash"]

                if r2_key not in r2_calendar_files:
                    calendar_to_upload.append((r2_key, local_path, "missing"))
                    calendar_missing += 1
                elif local_hash and r2_calendar_files[r2_key]["etag"] != local_hash:
                    calendar_to_upload.append((r2_key, local_path, "changed"))
                    calendar_changed += 1

            if calendar_to_upload:
                print(f"   -> 누락: {calendar_missing}개, 변경: {calendar_changed}개")
                success_calendar = 0
                fail_calendar = 0
                for r2_key, local_path, status in tqdm(
                    calendar_to_upload, desc="Uploading calendar files"
                ):
                    if upload_file_to_r2(local_path, r2_key):
                        success_calendar += 1
                    else:
                        fail_calendar += 1
                        tqdm.write(f"[FAIL] {r2_key} ({status})")
                print(f"   -> 성공: {success_calendar}, 실패: {fail_calendar}")
            else:
                print("   -> calendar 폴더 변경사항 없음")
        else:
            print("   -> calendar 폴더 없음")
    else:
        print("\n[4/6] calendar-events.json 및 calendar 폴더 확인 건너뜀 (요청 대상 아님)")

    # 5. logos 폴더 체크
    if run_all or "logos" in target_sections:
        print("\n[5/6] logos 폴더 확인 중...")
        if os.path.exists("public/logos"):
            r2_logos_files = get_r2_files("logos/")
            local_logos_files = get_local_files("public/logos", "*")  # 모든 파일

            logos_to_upload = []
            logos_missing = 0
            logos_changed = 0

            for r2_key, file_info in local_logos_files.items():
                local_path = file_info["path"]
                local_hash = file_info["hash"]

                if r2_key not in r2_logos_files:
                    logos_to_upload.append((r2_key, local_path, "missing"))
                    logos_missing += 1
                elif local_hash and r2_logos_files[r2_key]["etag"] != local_hash:
                    logos_to_upload.append((r2_key, local_path, "changed"))
                    logos_changed += 1

            if logos_to_upload:
                print(f"   -> 누락: {logos_missing}개, 변경: {logos_changed}개")
                success_logo = 0
                fail_logo = 0
                for r2_key, local_path, status in tqdm(
                    logos_to_upload, desc="Uploading logos"
                ):
                    if upload_file_to_r2(local_path, r2_key):
                        success_logo += 1
                    else:
                        fail_logo += 1
                        tqdm.write(f"[FAIL] {r2_key} ({status})")
                print(f"   -> 성공: {success_logo}, 실패: {fail_logo}")
            else:
                print("   -> 변경사항 없음")
        else:
            print("   -> 폴더 없음")
    else:
        print("\n[5/6] logos 폴더 확인 건너뜀 (요청 대상 아님)")

    # 최종 결과
    print("\n" + "=" * 60)
    print("  동기화 완료!")
    print("=" * 60)

    # 최종 파일 수 확인
    print("\n[최종 확인]")

    if run_all or "data" in target_sections:
        final_r2_files = get_r2_files()
        final_r2_data_files = [k for k in final_r2_files if k.startswith("data/")]

        print(f"R2 총 파일 수: {len(final_r2_files)}개")
        print(f"R2 data 파일 수: {len(final_r2_data_files)}개")
        print(f"로컬 data 파일 수: {len(local_data_files)}개")

        if len(final_r2_data_files) >= len(local_data_files):
            print("\n[OK] 모든 파일이 R2에 동기화되었습니다!")
            print(f"\n예시 URL:")
            print(f"  - {config['public_url']}/nav.json")
            print(f"  - {config['public_url']}/data/005930-ks.json")
        else:
            missing_count = len(local_data_files) - len(final_r2_data_files)
            print(
                f"\n[WARNING] 여전히 {missing_count}개 파일이 누락되어 있을 수 있습니다."
            )


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="R2 전체 동기화 스크립트 (부분 동기화 지원)"
    )
    parser.add_argument(
        "--target",
        "-t",
        action="append",
        choices=["all", "data", "nav", "sidebar", "calendar", "logos"],
        help="동기화할 섹션 선택 (여러 번 지정 가능). 지정하지 않으면 all",
    )

    args = parser.parse_args()
    if not args.target:
        return {"all"}

    targets = set(args.target)
    if "all" in targets and len(targets) > 1:
        print("[WARNING] 'all'과 다른 타겟이 함께 지정되었습니다. 'all'만 사용합니다.")
        return {"all"}

    return targets


if __name__ == "__main__":
    selected_targets = parse_arguments()
    upload_missing_files(selected_targets)
