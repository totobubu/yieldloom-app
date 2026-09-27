#!/usr/bin/env python3
# scripts/upload_specific_to_r2.py
"""
특정 파일만 R2에 업로드하는 스크립트

사용법:
  python scripts/upload_specific_to_r2.py public/nav.json
  python scripts/upload_specific_to_r2.py public/data/aapl.json public/data/tsla.json
  python scripts/upload_specific_to_r2.py "public/data/*.json"
"""

import os
import sys
import glob
from pathlib import Path
from tqdm import tqdm
from r2_helper import upload_file_to_r2, load_r2_config, R2_AVAILABLE


def parse_file_arguments(args):
    """
    커맨드라인 인자를 파일 경로 목록으로 변환
    
    Args:
        args: 커맨드라인 인자 목록 (glob 패턴 지원)
    
    Returns:
        list: [(로컬 경로, R2 키)] 튜플 목록
    """
    upload_targets = []
    
    for arg in args:
        # Windows/Linux 경로 처리
        arg = arg.replace("\\", "/")
        
        # Glob 패턴 처리
        if "*" in arg or "?" in arg:
            matched_files = glob.glob(arg, recursive=True)
            for file_path in matched_files:
                file_path = file_path.replace("\\", "/")
                if os.path.isfile(file_path):
                    r2_key = extract_r2_key(file_path)
                    if r2_key:
                        upload_targets.append((file_path, r2_key))
        else:
            # 일반 파일 경로
            if os.path.isfile(arg):
                r2_key = extract_r2_key(arg)
                if r2_key:
                    upload_targets.append((arg, r2_key))
            else:
                print(f"⚠️  파일을 찾을 수 없습니다: {arg}")
    
    return upload_targets


def extract_r2_key(file_path):
    """
    로컬 파일 경로에서 R2 키 추출
    
    Args:
        file_path: 로컬 파일 경로
    
    Returns:
        str: R2 키 또는 None
    """
    file_path = file_path.replace("\\", "/")
    
    # public/ 폴더 내의 파일만 처리
    if "public/" in file_path:
        return file_path.split("public/", 1)[1]
    
    # public/ 없이 직접 지정된 경우 (예: data/aapl.json)
    # 그대로 R2 키로 사용
    return file_path


def upload_specific_files(file_paths):
    """특정 파일들만 R2에 업로드"""
    print("=" * 70)
    print("  R2 업로드 (특정 파일)")
    print("=" * 70)
    
    if not R2_AVAILABLE:
        print("❌ boto3가 설치되지 않았습니다.")
        return 1
    
    try:
        config = load_r2_config()
        print(f"[OK] R2 버킷: {config['bucket_name']}")
        print(f"[OK] Public URL: {config['public_url']}\n")
    except Exception as e:
        print(f"❌ R2 설정을 로드할 수 없습니다: {e}")
        return 1
    
    # 파일 인자 파싱
    print(f"[1/2] 업로드 대상 확인 중...")
    upload_targets = parse_file_arguments(file_paths)
    
    if not upload_targets:
        print("❌ 업로드할 파일이 없습니다.")
        print("\n사용법:")
        print("  python scripts/upload_specific_to_r2.py public/nav.json")
        print("  python scripts/upload_specific_to_r2.py public/data/aapl.json public/data/tsla.json")
        print('  python scripts/upload_specific_to_r2.py "public/data/*.json"')
        return 1
    
    print(f"   ✓ 업로드 대상: {len(upload_targets)}개")
    
    # 파일 타입별 개수 표시
    file_types = {}
    for _, r2_key in upload_targets:
        if r2_key.startswith("data/"):
            file_types["data"] = file_types.get("data", 0) + 1
        elif r2_key.startswith("sidebar/"):
            file_types["sidebar"] = file_types.get("sidebar", 0) + 1
        elif r2_key.startswith("logos/"):
            file_types["logos"] = file_types.get("logos", 0) + 1
        elif r2_key == "nav.json":
            file_types["nav.json"] = 1
        elif r2_key == "calendar-events.json":
            file_types["calendar-events.json"] = 1
        else:
            file_types["기타"] = file_types.get("기타", 0) + 1
    
    print("\n   [업로드 대상 상세]")
    for file_type, count in sorted(file_types.items()):
        print(f"     - {file_type}: {count}개")
    
    # 파일 업로드
    print(f"\n[2/2] R2에 업로드 중...")
    success_count = 0
    fail_count = 0
    
    for local_path, r2_key in tqdm(upload_targets, desc="Uploading"):
        try:
            if upload_file_to_r2(local_path, r2_key):
                success_count += 1
            else:
                fail_count += 1
                tqdm.write(f"   ❌ {r2_key}")
        except Exception as e:
            fail_count += 1
            tqdm.write(f"   ❌ {r2_key}: {e}")
    
    # 결과 출력
    print("\n" + "=" * 70)
    print("  업로드 완료!")
    print("=" * 70)
    print(f"✅ 성공: {success_count}개")
    if fail_count > 0:
        print(f"❌ 실패: {fail_count}개")
    
    print(f"\n💡 업로드된 파일:")
    for i, (_, r2_key) in enumerate(upload_targets[:5]):
        print(f"   - {config['public_url']}/{r2_key}")
    
    if len(upload_targets) > 5:
        print(f"   ... 외 {len(upload_targets) - 5}개")
    
    return 0 if fail_count == 0 else 1


def main():
    """메인 실행"""
    if len(sys.argv) < 2:
        print("=" * 70)
        print("  R2 특정 파일 업로드")
        print("=" * 70)
        print("\n사용법:")
        print("  python scripts/upload_specific_to_r2.py <파일1> [파일2] [파일3] ...")
        print("\n예시:")
        print("  # 단일 파일")
        print("  python scripts/upload_specific_to_r2.py public/nav.json")
        print("\n  # 여러 파일")
        print("  python scripts/upload_specific_to_r2.py public/nav.json public/calendar-events.json")
        print("\n  # 특정 티커 파일들")
        print("  python scripts/upload_specific_to_r2.py public/data/aapl.json public/data/tsla.json")
        print("\n  # Glob 패턴 (따옴표 필수)")
        print('  python scripts/upload_specific_to_r2.py "public/data/0*.json"')
        print('  python scripts/upload_specific_to_r2.py "public/sidebar/*.json"')
        print("\n  # 디렉토리 내 모든 JSON 파일")
        print('  python scripts/upload_specific_to_r2.py "public/data/*.json"')
        return 1
    
    file_paths = sys.argv[1:]
    return upload_specific_files(file_paths)


if __name__ == "__main__":
    sys.exit(main())
