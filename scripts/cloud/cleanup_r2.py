#!/usr/bin/env python3
"""R2에서 로컬에 없는 파일 정리 스크립트 (통합)"""

import argparse
from pathlib import Path

from r2_helper import get_r2_client, load_r2_config, list_r2_files, R2_AVAILABLE


def collect_local_keys(target):
    """로컬 디렉터리의 R2 키 집합을 반환"""
    
    if target == "logos":
        root = Path("public/logos")
        pattern = "*"
    elif target == "data":
        root = Path("public/data")
        pattern = "*.json"
    else:
        return set()
    
    if not root.exists():
        return set()
    
    keys = set()
    for item in root.rglob(pattern):
        if item.is_file():
            relative = item.relative_to(Path("public"))
            keys.add(str(relative).replace("\\", "/"))
    return keys


def delete_r2_objects(s3_client, bucket_name, keys):
    """R2에서 제공된 키들을 삭제 (1000개 단위 배치)"""
    
    deleted = 0
    failures = []
    batch = []
    
    for key in keys:
        batch.append({"Key": key})
        if len(batch) == 1000:
            resp = s3_client.delete_objects(Bucket=bucket_name, Delete={"Objects": batch})
            deleted += len(resp.get("Deleted", []))
            failures.extend(resp.get("Errors", []))
            batch = []
    
    if batch:
        resp = s3_client.delete_objects(Bucket=bucket_name, Delete={"Objects": batch})
        deleted += len(resp.get("Deleted", []))
        failures.extend(resp.get("Errors", []))
    
    return deleted, failures


def main():
    parser = argparse.ArgumentParser(
        description="Cloudflare R2에서 로컬에 존재하지 않는 파일을 정리합니다.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  # logos 폴더 정리 (dry-run)
  python scripts/cloud/cleanup_r2.py --target logos
  
  # data 폴더 전체 정리 (dry-run)
  python scripts/cloud/cleanup_r2.py --target data
  
  # 특정 market만 정리 (dry-run)
  python scripts/cloud/cleanup_r2.py --target data --market kosdaq
  
  # 실제 삭제
  python scripts/cloud/cleanup_r2.py --target logos --apply
  python scripts/cloud/cleanup_r2.py --target data --market kosdaq --apply
        """,
    )
    parser.add_argument(
        "--target",
        type=str,
        choices=["logos", "data"],
        required=True,
        help="정리할 대상 폴더 (logos 또는 data)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="dry-run 대신 실제로 R2 파일을 삭제합니다.",
    )
    parser.add_argument(
        "--market",
        type=str,
        help="data 타겟일 때만 사용. 특정 market만 정리 (예: kosdaq, kospi, nasdaq, nyse).",
    )
    
    args = parser.parse_args()
    
    # market 옵션은 data 타겟일 때만 사용 가능
    if args.market and args.target != "data":
        parser.error("--market 옵션은 --target data 일 때만 사용할 수 있습니다.")
    
    if not R2_AVAILABLE:
        print("[ERROR] boto3가 설치되어 있지 않습니다. 먼저 'pip install boto3' 를 실행하세요.")
        return 1
    
    # 로컬 파일 수집 (R2 설정 없이도 가능)
    local_keys = collect_local_keys(args.target)
    
    if args.target == "data" and args.market:
        print(f"[INFO] 로컬 {args.market} 파일 {len(local_keys)}개")
    else:
        print(f"[INFO] 로컬 {args.target} 파일 {len(local_keys)}개")
    
    # R2 설정 로드 (R2 비교를 위해 필요)
    try:
        config = load_r2_config()
    except Exception as exc:
        print(f"\n[ERROR] R2 설정을 로드할 수 없습니다: {exc}")
        print("\n💡 R2 설정 방법:")
        print("   1. 환경 변수 설정:")
        print("      - R2_ACCOUNT_ID")
        print("      - R2_ACCESS_KEY_ID")
        print("      - R2_SECRET_ACCESS_KEY")
        print("      - R2_BUCKET_NAME")
        print("   2. 또는 .env.r2 파일 생성 (프로젝트 루트)")
        print("\n⚠️  R2 설정 없이는 로컬 파일만 확인할 수 있습니다.")
        print(f"   현재 로컬 {args.target} 파일: {len(local_keys)}개")
        return 1
    
    # market 필터링 (data 타겟일 때만)
    if args.target == "data" and args.market:
        market_prefix = f"data/{args.market.lower()}/"
        local_keys = {k for k in local_keys if k.startswith(market_prefix)}
    
    # R2 파일 수집
    if args.target == "data" and args.market:
        r2_prefix = f"data/{args.market.lower()}/"
    else:
        r2_prefix = f"{args.target}/"
    
    r2_keys = set(list_r2_files(r2_prefix))
    
    if args.target == "data" and args.market:
        print(f"[INFO] R2 {args.market} 파일 {len(r2_keys)}개")
    else:
        print(f"[INFO] R2 {args.target} 파일 {len(r2_keys)}개")
    
    if not r2_keys:
        print(f"[INFO] R2 {r2_prefix} 폴더가 비어있거나 목록을 가져오지 못했습니다.")
        return 0
    
    # R2에만 있는 파일 찾기
    stale_keys = sorted(r2_keys - local_keys)
    if not stale_keys:
        if args.target == "data" and args.market:
            print(f"[OK] R2와 로컬 {args.market} 폴더가 이미 일치합니다.")
        else:
            print(f"[OK] R2와 로컬 {args.target} 폴더가 이미 일치합니다.")
        return 0
    
    print(f"\n[DRY-RUN] 삭제 대상 (R2에만 존재, {len(stale_keys)}개):")
    preview = stale_keys[:20]
    for key in preview:
        print(f"  - {key}")
    if len(stale_keys) > len(preview):
        print(f"  ... 외 {len(stale_keys) - len(preview)}개")
    
    if not args.apply:
        print(
            "\n현재는 dry-run 상태입니다. 실제로 삭제하려면 --apply 옵션을 추가해 다시 실행하세요."
        )
        return 0
    
    # 삭제 확인
    print(f"\n⚠️  {len(stale_keys)}개 파일을 삭제하려고 합니다.")
    response = input("계속하시겠습니까? (yes/no): ")
    if response.lower() not in ['yes', 'y']:
        print("❌ 취소되었습니다.")
        return 0
    
    print("\n[APPLY] R2에서 불필요한 파일 삭제 중...")
    s3_client, bucket_name = get_r2_client()
    if not s3_client:
        print("[ERROR] R2 클라이언트를 초기화할 수 없습니다.")
        return 1
    
    deleted, failures = delete_r2_objects(s3_client, bucket_name, stale_keys)
    print(f"[OK] 삭제 완료: {deleted}개")
    
    if failures:
        print(f"[WARN] 삭제 실패 항목 ({len(failures)}개)")
        for failure in failures[:10]:  # 최대 10개만 표시
            print(f"  - {failure.get('Key')}: {failure.get('Code')} ({failure.get('Message')})")
        if len(failures) > 10:
            print(f"  ... 외 {len(failures) - 10}개")
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
