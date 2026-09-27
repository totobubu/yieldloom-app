# scripts/r2_helper.py
"""Cloudflare R2 업로드 헬퍼 (간소화 버전)"""
import os
import json
from pathlib import Path

try:
    import boto3
    from botocore.client import Config
    R2_AVAILABLE = True
except ImportError:
    R2_AVAILABLE = False
    print("[WARNING] boto3가 설치되지 않았습니다. R2 업로드를 건너뜁니다.")


def get_r2_client():
    """R2 클라이언트 생성"""
    if not R2_AVAILABLE:
        return None, None
    
    # 환경변수에서 R2 설정 로드
    account_id = os.getenv('R2_ACCOUNT_ID')
    access_key_id = os.getenv('R2_ACCESS_KEY_ID')
    secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
    bucket_name = os.getenv('R2_BUCKET_NAME')
    
    # 환경변수가 없으면 .env.r2 파일에서 로드 (프로젝트 루트)
    if not all([account_id, access_key_id, secret_access_key, bucket_name]):
        # 프로젝트 루트 찾기: scripts/cloud/r2_helper.py -> scripts/cloud -> scripts -> 프로젝트 루트
        env_file = Path(__file__).parent.parent.parent / '.env.r2'
        if env_file.exists():
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        os.environ[key] = value
            
            account_id = os.getenv('R2_ACCOUNT_ID')
            access_key_id = os.getenv('R2_ACCESS_KEY_ID')
            secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
            bucket_name = os.getenv('R2_BUCKET_NAME')
    
    if not all([account_id, access_key_id, secret_access_key, bucket_name]):
        return None, None
    
    try:
        s3_client = boto3.client(
            's3',
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=Config(signature_version='s3v4'),
            region_name='auto'
        )
        return s3_client, bucket_name
    except Exception as e:
        print(f"[ERROR] R2 클라이언트 생성 실패: {e}")
        return None, None


def load_r2_config():
    """R2 설정 로드"""
    # 환경변수에서 R2 설정 로드
    account_id = os.getenv('R2_ACCOUNT_ID')
    access_key_id = os.getenv('R2_ACCESS_KEY_ID')
    secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
    bucket_name = os.getenv('R2_BUCKET_NAME')
    public_url = os.getenv('R2_PUBLIC_URL', '')
    
    # 환경변수가 없으면 .env.r2 파일에서 로드 (프로젝트 루트)
    if not all([account_id, access_key_id, secret_access_key, bucket_name]):
        # 프로젝트 루트 찾기: scripts/cloud/r2_helper.py -> scripts/cloud -> scripts -> 프로젝트 루트
        env_file = Path(__file__).parent.parent.parent / '.env.r2'
        if env_file.exists():
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        os.environ[key] = value
            
            account_id = os.getenv('R2_ACCOUNT_ID')
            access_key_id = os.getenv('R2_ACCESS_KEY_ID')
            secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
            bucket_name = os.getenv('R2_BUCKET_NAME')
            public_url = os.getenv('R2_PUBLIC_URL', '')
    
    if not all([account_id, access_key_id, secret_access_key, bucket_name]):
        raise ValueError("R2 설정이 완전하지 않습니다.")
    
    return {
        'account_id': account_id,
        'access_key_id': access_key_id,
        'secret_access_key': secret_access_key,
        'bucket_name': bucket_name,
        'public_url': public_url
    }


def upload_file_to_r2(local_file_path, r2_key):
    """파일을 R2에 업로드"""
    s3_client, bucket_name = get_r2_client()
    if not s3_client:
        return False
    
    try:
        # 파일 확장자에 따른 Content-Type 설정
        ext = Path(local_file_path).suffix.lower()
        content_type_map = {
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.ico': 'image/x-icon',
        }
        content_type = content_type_map.get(ext, 'application/octet-stream')
        
        with open(local_file_path, 'rb') as f:
            s3_client.put_object(
                Bucket=bucket_name,
                Key=r2_key,
                Body=f.read(),
                ContentType=content_type,
                CacheControl='public, max-age=300'
            )
        return True
    except Exception as e:
        print(f"[ERROR] R2 업로드 실패 ({r2_key}): {e}")
        return False


def upload_json_to_r2(data, key):
    """JSON 데이터를 R2에 업로드"""
    s3_client, bucket_name = get_r2_client()
    if not s3_client:
        return False
    
    try:
        json_data = json.dumps(data, indent=2, ensure_ascii=False)
        s3_client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=json_data.encode('utf-8'),
            ContentType='application/json',
            CacheControl='public, max-age=300'
        )
        return True
    except Exception as e:
        print(f"[ERROR] R2 업로드 실패 ({key}): {e}")
        return False


def download_file_from_r2(r2_key, local_file_path):
    """R2에서 파일 다운로드"""
    s3_client, bucket_name = get_r2_client()
    if not s3_client:
        return False
    
    try:
        # 디렉토리 생성
        local_path = Path(local_file_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 파일 다운로드
        s3_client.download_file(bucket_name, r2_key, str(local_file_path))
        return True
    except Exception as e:
        print(f"[ERROR] R2 다운로드 실패 ({r2_key}): {e}")
        return False


def delete_r2_files(keys):
    """R2에서 여러 파일 삭제"""
    s3_client, bucket_name = get_r2_client()
    if not s3_client:
        return [], list(keys or [])

    keys = [key for key in keys if key]
    if not keys:
        return [], []

    deleted = []
    errors = []
    chunk_size = 1000

    for index in range(0, len(keys), chunk_size):
        chunk = keys[index : index + chunk_size]
        try:
            response = s3_client.delete_objects(
                Bucket=bucket_name,
                Delete={"Objects": [{"Key": key} for key in chunk], "Quiet": True},
            )
            deleted.extend(obj.get("Key") for obj in response.get("Deleted", []))
            errors.extend(err.get("Key") for err in response.get("Errors", []))
        except Exception as exc:
            print(f"[ERROR] R2 삭제 실패 ({len(chunk)}개 묶음): {exc}")
            errors.extend(chunk)

    return deleted, errors


def read_json_from_r2(key):
    """R2에서 JSON 파일 읽기 (다운로드 없이)"""
    s3_client, bucket_name = get_r2_client()
    if not s3_client:
        return None
    try:
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
        content = response["Body"].read().decode("utf-8")
        return json.loads(content)
    except Exception as e:
        print(f"[ERROR] R2 JSON 읽기 실패 ({key}): {e}")
        return None


def list_r2_files(prefix=""):
    """R2 버킷에서 파일 목록 가져오기"""
    s3_client, bucket_name = get_r2_client()
    if not s3_client:
        return []
    
    try:
        files = []
        paginator = s3_client.get_paginator("list_objects_v2")
        
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            if "Contents" in page:
                for obj in page["Contents"]:
                    files.append(obj["Key"])
        
        return files
    except Exception as e:
        print(f"[ERROR] R2 파일 목록 조회 실패: {e}")
        return []


def save_json_with_r2(file_path, data):
    """로컬 저장 + R2 업로드"""
    from scripts.utils import save_json_file
    
    # 로컬 저장
    local_ok = save_json_file(file_path, data)
    
    # R2 업로드 시도
    if R2_AVAILABLE:
        path_str = str(file_path).replace("\\", "/")
        if "public/" in path_str:
            r2_key = path_str.split("public/", 1)[1]
            upload_json_to_r2(data, r2_key)
    
    return local_ok

