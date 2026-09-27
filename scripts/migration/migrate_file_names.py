#!/usr/bin/env python3
"""
기존 파일명을 새 형식으로 마이그레이션하는 스크립트

기존: public/data/{{market}}/{{symbol}}-{{suffix}}.json
새 형식: public/data/{{market}}/{{symbol}}.json

예: 473330-kq.json -> 473330.json
"""
import json
import shutil
import sys
from pathlib import Path
from typing import List, Tuple, Optional

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.utils import DATA_DIR, get_base_symbol

# 접미사 패턴
SUFFIX_PATTERNS = ['-ks', '-kq', '-kn', '-ko']


def find_files_to_migrate(data_dir: Path) -> List[Tuple[Path, Path]]:
    """
    마이그레이션이 필요한 파일들을 찾습니다.
    
    Returns:
        List[Tuple[Path, Path]]: (기존 파일 경로, 새 파일 경로) 튜플 리스트
    """
    migrations = []
    
    if not data_dir.exists():
        print(f"❌ 데이터 디렉토리를 찾을 수 없습니다: {data_dir}")
        return migrations
    
    # 각 market 디렉토리 순회
    for market_dir in data_dir.iterdir():
        if not market_dir.is_dir():
            continue
        
        market_name = market_dir.name
        print(f"\n📁 {market_name} 디렉토리 검사 중...")
        
        # 각 JSON 파일 확인
        for file_path in market_dir.glob("*.json"):
            filename = file_path.name
            base_name = filename.replace(".json", "")
            
            # 접미사가 있는 파일인지 확인
            needs_migration = False
            new_base_name = base_name
            
            for suffix in SUFFIX_PATTERNS:
                if base_name.lower().endswith(suffix):
                    # 접미사 제거
                    new_base_name = base_name[: -len(suffix)]
                    needs_migration = True
                    break
            
            if not needs_migration:
                continue
            
            # 새 파일 경로
            new_file_path = market_dir / f"{new_base_name}.json"
            
            # 새 파일이 이미 존재하는지 확인
            if new_file_path.exists():
                print(f"  ⚠️  건너뜀: {filename} -> {new_file_path.name} (이미 존재)")
                continue
            
            migrations.append((file_path, new_file_path))
    
    return migrations


def migrate_file(old_path: Path, new_path: Path, dry_run: bool = False) -> bool:
    """
    파일을 새 이름으로 이동합니다.
    
    Args:
        old_path: 기존 파일 경로
        new_path: 새 파일 경로
        dry_run: True면 실제로 이동하지 않고 시뮬레이션만
    
    Returns:
        bool: 성공 여부
    """
    try:
        if dry_run:
            print(f"  [DRY RUN] {old_path.name} -> {new_path.name}")
            return True
        
        # 파일 이동
        shutil.move(str(old_path), str(new_path))
        print(f"  ✅ {old_path.name} -> {new_path.name}")
        return True
    except Exception as e:
        print(f"  ❌ {old_path.name} 이동 실패: {e}")
        return False


def upload_to_r2(file_path: Path, r2_key: str) -> bool:
    """
    R2에 파일을 업로드합니다.
    
    Args:
        file_path: 로컬 파일 경로
        r2_key: R2 키 (예: "data/kosdaq/473330.json")
    
    Returns:
        bool: 성공 여부
    """
    try:
        from scripts.r2_helper import upload_json_to_r2
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        upload_json_to_r2(data, r2_key)
        return True
    except ImportError:
        print(f"  ⚠️  R2 헬퍼를 찾을 수 없습니다. R2 업로드를 건너뜁니다.")
        return False
    except Exception as e:
        print(f"  ⚠️  R2 업로드 실패 ({r2_key}): {e}")
        return False


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description="기존 파일명을 새 형식으로 마이그레이션"
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='실제로 파일을 이동하지 않고 시뮬레이션만 실행'
    )
    parser.add_argument(
        '--upload-r2',
        action='store_true',
        help='마이그레이션 후 R2에 업로드'
    )
    parser.add_argument(
        '--market',
        type=str,
        help='특정 market만 마이그레이션 (예: kosdaq, kospi)'
    )
    
    args = parser.parse_args()
    
    print("=" * 80)
    print("🔄 파일명 마이그레이션 시작")
    print("=" * 80)
    
    if args.dry_run:
        print("⚠️  DRY RUN 모드: 실제로 파일을 이동하지 않습니다.")
    
    # 마이그레이션 대상 파일 찾기
    data_dir = DATA_DIR
    if args.market:
        data_dir = DATA_DIR / args.market.lower()
        if not data_dir.exists():
            print(f"❌ {args.market} 디렉토리를 찾을 수 없습니다.")
            sys.exit(1)
        # market 디렉토리 하나만 처리
        migrations = []
        for file_path in data_dir.glob("*.json"):
            filename = file_path.name
            base_name = filename.replace(".json", "")
            
            needs_migration = False
            new_base_name = base_name
            
            for suffix in SUFFIX_PATTERNS:
                if base_name.lower().endswith(suffix):
                    new_base_name = base_name[: -len(suffix)]
                    needs_migration = True
                    break
            
            if not needs_migration:
                continue
            
            new_file_path = data_dir / f"{new_base_name}.json"
            if new_file_path.exists():
                print(f"  ⚠️  건너뜀: {filename} -> {new_file_path.name} (이미 존재)")
                continue
            
            migrations.append((file_path, new_file_path))
    else:
        migrations = find_files_to_migrate(DATA_DIR)
    
    if not migrations:
        print("\n✅ 마이그레이션이 필요한 파일이 없습니다.")
        return
    
    print(f"\n📊 총 {len(migrations)}개 파일 마이그레이션 예정")
    
    # 사용자 확인
    if not args.dry_run:
        response = input("\n계속하시겠습니까? (y/N): ")
        if response.lower() != 'y':
            print("❌ 취소되었습니다.")
            return
    
    # 파일 마이그레이션
    success_count = 0
    failed_count = 0
    
    for old_path, new_path in migrations:
        success = migrate_file(old_path, new_path, dry_run=args.dry_run)
        if success:
            success_count += 1
            
            # R2 업로드
            if args.upload_r2 and not args.dry_run:
                # R2 키 생성: data/{{market}}/{{filename}}
                market_dir = old_path.parent.name
                r2_key = f"data/{market_dir}/{new_path.name}"
                upload_to_r2(new_path, r2_key)
        else:
            failed_count += 1
    
    # 결과 요약
    print("\n" + "=" * 80)
    print("📊 마이그레이션 결과")
    print("=" * 80)
    print(f"✅ 성공: {success_count}개")
    if failed_count > 0:
        print(f"❌ 실패: {failed_count}개")
    print("=" * 80)


if __name__ == "__main__":
    main()

