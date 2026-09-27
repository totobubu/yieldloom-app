
import json
import glob
from pathlib import Path
import subprocess

DATA_DIR = Path("public/data")

updates = {
    "AAPW": 0.150851,
    "AMDW": 0.724268,
    "AMZW": 0.199957,
    "ARMW": 0.184886,
    "AVGW": 0.488270,
    "BABW": 0.479193,
    "BRKW": 0.124906,
    "COIW": 0.233998,
    "COSW": 0.281588,
    "GOOW": 0.501459,
    "HOOW": 0.381771,
    "METW": 0.125471,
    "MSFW": 0.113700,
    "MSTW": 0.199294,
    "NFLW": 0.173226,
    "NVDW": 0.339636,
    "PLTW": 0.303133,
    "TSLW": 0.249688,
    "UBEW": 0.266892,
    "UNHW": 0.248864,
    "GDXW": 1.081223,
    "GLDW": 0.561270,
    "TSYW": 0.093108
}

def find_json_path(ticker):
    pattern = str(DATA_DIR / "**" / f"{ticker.lower()}.json")
    matches = glob.glob(pattern, recursive=True)
    if matches:
        return Path(matches[0])
    return None

def update_json(path, date_str, amount):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        updated = False
        target_list = None

        if isinstance(data, list):
            target_list = data
        elif isinstance(data, dict):
            if 'backtestData' in data:
                target_list = data['backtestData']
            elif 'dividend_history' in data:
                target_list = data['dividend_history']
            elif 'dividends' in data:
                target_list = data['dividends']

        if target_list is None:
            print(f"[!] No list found in {path}")
            return False

        for entry in target_list:
            if entry.get('date') == date_str:
                if entry.get('expected') == True:
                    del entry['expected']
                    entry['amountFixed'] = amount
                    updated = True
                    print(f"[+] Updated {path.name}: {amount}")
                elif 'amountFixed' in entry:
                     # Check if we need to update existing
                     if abs(entry['amountFixed'] - amount) > 0.0001:
                         entry['amountFixed'] = amount
                         updated = True
                         print(f"[+] Corrected {path.name}: {entry['amountFixed']} -> {amount}")
                     else:
                         print(f"[=] Already up to date {path.name}")
        
        if updated:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            # Prettier
            try:
                subprocess.run(["npx", "prettier", "--write", str(path)], shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except:
                pass
            return True

    except Exception as e:
        print(f"[!] Error {path}: {e}")

def main():
    date_str = "2026-01-26"
    print(f"Updating for date: {date_str}")
    
    for ticker, amount in updates.items():
        path = find_json_path(ticker)
        if path:
            update_json(path, date_str, amount)
        else:
            print(f"[!] File not found for {ticker}")

if __name__ == "__main__":
    main()
