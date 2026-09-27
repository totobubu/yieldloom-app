#!/usr/bin/env python3
"""
R2 데이터 수동 관리 스크립트
기능:
1. 특정 심볼 또는 예상 배당일 기준으로 R2 데이터 로컬 다운로드
2. 로컬에서 데이터 수정 후 R2로 재업로드 (검증 포함)

사용법:
python scripts/utils/manage_r2_data.py --symbol TOPW
python scripts/utils/manage_r2_data.py --expected 2025-12-16
python scripts/utils/manage_r2_data.py --group 화요일 수요일 목요일  
python scripts/utils/manage_r2_data.py --group 디파이언스수요일 디파이언스목요일
python scripts/utils/manage_r2_data.py --group 일드부스트
python scripts/utils/manage_r2_data.py --company 회사이름
python scripts/utils/manage_r2_data.py --action upload
"""
import argparse
import sys
import json
import time
from pathlib import Path
from datetime import datetime

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.cloud.r2_helper import (
    load_r2_config,
    download_file_from_r2,
    upload_file_to_r2,
    read_json_from_r2,
)
from scripts.utils import get_data_file_path

PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = PUBLIC_DIR / "data"

MARKET_SUBDIR_ALIASES = {
    "KOSPI": "kospi",
    "KOSDAQ": "kosdaq",
    "KONEX": "konex",
    "KRX": "krx",
    "NYSE": "nyse",
    "NASDAQ": "nasdaq",
    "AMEX": "amex",
}

SYMBOL_GROUPS = {
    "화요일": [
        "TOPW", "XPAY"
    ],
    "일드화요일": [
        "MSST", "NVIT", "TEST"
    ],
    "일드수요일": [
        "CHPY", 
        "FEAT", "FIVY", 
        "GPTY", 
        "LFGY", 
        "QDTY", 
        "RDTY", 
        "SDTY", "SLTY", 
        "ULTY", 
        "YMAG", "YMAX", "YBTC", "YETH"
    ],
    "일드목요일": [
        "ABNY", "AIYY", "AMDY", "AMZY", "APLY", 
        "BABO", "BRKC", 
        "CONY", "CRCO", "CRSH", "CVNY", 
        "DIPS", "DISO", "DRAY", 
        "FBY", "FIAT", 
        "GDXY", "GMEY", "GOOY", 
        "HIYY", "HOOY", 
        "JPO", 
        "MARO", "MRNY", "MSFO", "MSTY", 
        "NFLY", "NVDY", 
        "OARK", 
        "PLTY", "PYPY", 
        "RBLY", "RDYY", 
        "SMCY", "SNOY", 
        "TSLY", "TSMY", 
        "WNTR", 
        "XOMO", "XYZY", 
        "YBIT", "YQQQ", 
        "QDTE", "XDTE", "RDTE"
    ],
    "위클리페이": [
        "AAPW", "AMDW", "AMZW", "ARMW", "AVGW", "BABW", "BRKW", "COIW", "COSW", "GOOW", "HOOW", "METW", "MSFW", "MSTW", "NFLW", "NVDW", "PLTW", "UBEW", "UNHW", "GDXW", "GLDW", "TSYW"
    ],
    "디파이언스수요일": [
        "PLT", "MST", "QLDY"
    ],
    "디파이언스목요일": [
        "WDTE", "IWMY", "USOY", "GLDY", "QQQY"
    ],
    "일드부스트": [
        "MAAY", "IOYY", "RTYY", "COYY", "RGYY", "HMYY", "QBY", "TSYY", "SMYY", "HOYY", "SEMY", "BBYY", "NVYY", "NUGY", "PLYY", "MTYY", "AMYY", "XBTY", "AZYY", "TQQY", "FBYY", "YSPY"
    ],
    "렉스ii": [
        "NVII", "TSII", "MSII", "COII", "LLII", "CWII", "PLTI", "WMTI"
    ]
}

def get_market_dir_name(market):
    normalized = (market or "").strip().upper()
    return MARKET_SUBDIR_ALIASES.get(normalized, "misc")

def load_nav_map():
    """R2에서 nav.json을 로드하여 심볼->메타데이터 맵 생성"""
    print("⏳ Loading nav.json from R2...")
    nav_data = read_json_from_r2("nav.json")
    if not nav_data:
        print("❌ Failed to load nav.json from R2")
        return {}
    
    mapping = {}
    for entry in nav_data.get("nav", []):
        symbol = entry.get("symbol")
        if symbol:
            mapping[symbol.upper()] = entry
            # yfSymbol도 매핑 (옵션)
            if entry.get("yfSymbol"):
                mapping[entry.get("yfSymbol").upper()] = entry
    return mapping

def resolve_targets(args, nav_map):
    targets = set()

    # 0. Group based
    if args.group:
        query = args.group.replace(" ", "").lower()
        found_group = None
        for g_name, symbols in SYMBOL_GROUPS.items():
            if g_name.replace(" ", "").lower() == query:
                found_group = symbols
                break
        
        if found_group:
            print(f"   ✓ Group '{args.group}' matched {len(found_group)} symbols.")
            for sym in found_group:
                targets.add(sym.upper())
        else:
            print(f"⚠️  Group '{args.group}' not found. Available: {', '.join(SYMBOL_GROUPS.keys())}")

    # 0.5 Company based
    if args.company:
        query = args.company.strip().lower()
        found_company = set()
        for entry in nav_map.values():
            comp = str(entry.get("company") or "").lower()
            if query in comp:
                sym = entry.get("symbol")
                if sym:
                    found_company.add(sym.upper())
        
        if found_company:
            print(f"   ✓ Company '{args.company}' matched {len(found_company)} symbols.")
            targets.update(found_company)
        else:
            print(f"⚠️  Company matching '{args.company}' not found.")

    # 1. Symbol based
    if args.symbols:
        for sym in args.symbols:
            sym_upper = sym.upper()
            if sym_upper in nav_map:
                targets.add(sym_upper)
            else:
                print(f"⚠️  Symbol {sym} not found in nav.json. Assuming generic.")
                # 마켓 정보를 알 수 없으므로 nav에 없으면 처리가 어렵지만, 일단 추가해봄 (나중에 경로 추측)
                # 하지만 get_data_file_path는 market 정보가 필요함.
                # nav에 없으면 'misc' 또는 flat으로 가정해야 함.
                targets.add(sym_upper)

    # 2. Expected date based
    if args.expected:
        try:
            target_date = datetime.strptime(args.expected, "%Y-%m-%d") # 2025-12-11
        except ValueError:
            try:
                target_date = datetime.strptime(args.expected, "%y-%m-%d") # 25-12-11
            except ValueError:
                print("❌ Invalid date format. Use YYYY-MM-DD or YY-MM-DD")
                return []
        
        year_str = target_date.strftime("%Y")
        month_str = target_date.strftime("%m")
        date_str = target_date.strftime("%Y-%m-%d")
        
        cal_key = f"calendar/monthly/{year_str}/{month_str}.json"
        print(f"⏳ Loading calendar file: {cal_key}")
        cal_data = read_json_from_r2(cal_key)
        
        if cal_data:
            found_count = 0
            # cal_data structure: { "UsStock": { "DATE": [ {ticker: ...} ] } }
            for category, dates_map in cal_data.items():
                if date_str in dates_map:
                    events = dates_map[date_str]
                    for event in events:
                        ticker = event.get("ticker")
                        if ticker:
                            # event 객체에 'expected' 표시가 있는지 확인?
                            # 사용자는 'expected date 검색형'이라 했으므로 해당 날짜에 있는 모든 티커?
                            # 아니면 'expected' 배당인 경우만?
                            # 일단 해당 날짜에 이벤트가 있는 모든 티커를 대상으로 함.
                            targets.add(ticker.upper())
                            found_count += 1
            print(f"   ✓ Found {found_count} tickers for date {date_str}")
        else:
            print(f"⚠️  Calendar data not found for {year_str}-{month_str}")

    return list(targets)

def get_r2_key_and_local_path(symbol, nav_map):
    """
    심볼에 대한 R2 Key와 Local Path 결정
    nav_map 정보 활용, 없으면 기본 추측
    """
    meta = nav_map.get(symbol.upper())
    market = meta.get("market") if meta else None
    
    # get_data_file_path는 로컬 경로를 반환
    # R2 Key는 public/ 이후의 경로
    try:
        # layout="market"을 기본으로 가정 (v2)
        local_path = get_data_file_path(symbol, market, layout="market")
        # local_path: WindowsPath('c:/workspace/toto/public/data/nasdaq/tsly.json')
        
        # Convert to relative path from public root
        # We assume get_data_file_path returns absolute path inside PUBLIC_DIR
        rel_path = local_path.relative_to(PUBLIC_DIR)
        r2_key = rel_path.as_posix() # data/nasdaq/tsly.json
        
        return r2_key, local_path
    except Exception as e:
        print(f"⚠️  Path resolution failed for {symbol}: {e}")
        return None, None

def main():
    parser = argparse.ArgumentParser(description="Manage R2 Data Manually")
    parser.add_argument("--symbol", nargs="+", dest="symbols", help="List of symbols (e.g. TSLY NVDY)")
    parser.add_argument("--group", help="Predefined symbol group (e.g. 일드맥스화요일)")
    parser.add_argument("--company", help="Filter by company name (partial match, e.g. Defiance)")
    parser.add_argument("--expected", help="Expected date (YYYY-MM-DD or YY-MM-DD)")
    parser.add_argument("--action", choices=["download", "upload"], default="download", help="Action: download (default) or upload")
    
    args = parser.parse_args()
    
    is_explicit_target = args.symbols or args.expected or args.group or args.company

    if not is_explicit_target:
        if args.action != "upload":
            print("❌ To download, you must specify --symbol, --group, --company or --expected")
            print("   To upload all local files, use --action upload")
            return
        # If upload, we continue to auto-scan

    # Load NAV for metadata lookup
    nav_map = load_nav_map()
    
    items = []

    if is_explicit_target:
        targets = resolve_targets(args, nav_map)
        if not targets:
            print("❌ No targets found.")
            return
        
        print(f"\n🎯 Targets: {', '.join(targets)}")
        
        for sym in targets:
            r2_key, local_path = get_r2_key_and_local_path(sym, nav_map)
            if r2_key and local_path:
                items.append((sym, r2_key, local_path))
    
    # Auto-scan for upload if no explicit targets
    if args.action == "upload" and not items:
        print("\n🔎 Scanning local 'public/data' for files to upload...")
        if DATA_DIR.exists():
            for fpath in DATA_DIR.rglob("*.json"):
                try:
                    rel_path = fpath.relative_to(PUBLIC_DIR)
                    r2_key = rel_path.as_posix()
                    sym = fpath.stem.upper()
                    items.append((sym, r2_key, fpath))
                except Exception: pass
        print(f"   ✓ Found {len(items)} local files.")

    if not items:
        print("❌ No items to process.")
        return

    # Action: Download
    if args.action == "download":
        print("\n⬇️  Downloading files from R2...")
        count = 0
        for sym, r2_key, local_path in items:
            if download_file_from_r2(r2_key, local_path):
                print(f"   ✓ {sym}: {local_path}")
                count += 1
            else:
                print(f"   ❌ {sym}: Not found in R2 or download failed")
        print(f"   Total {count} files downloaded. You can now edit them.")

    # Action: Upload
    if args.action == "upload":
        print("\n⬆️  Uploading files to R2...")
        count = 0
        for sym, r2_key, local_path in items:
            if not local_path.exists():
                print(f"   ⚠️  {sym}: Local file not found ({local_path}), skipping.")
                continue
            
            # Validate JSON
            try:
                with open(local_path, 'r', encoding='utf-8') as f:
                    json.load(f)
            except json.JSONDecodeError as e:
                print(f"   ❌ {sym}: Invalid JSON, skipping upload! ({e})")
                continue

            if upload_file_to_r2(local_path, r2_key):
                print(f"   ✅ {sym}: Uploaded to {r2_key}")
                count += 1
                # Clean up local file
                try:
                    local_path.unlink()
                    print(f"      🗑️ Deleted local file")
                except Exception as e:
                    print(f"      ⚠️ Failed to delete local file: {e}")
            else:
                print(f"   ❌ {sym}: Upload failed")
        print(f"   Total {count} files uploaded.")

if __name__ == "__main__":
    main()
