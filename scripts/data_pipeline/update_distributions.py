import os
import re
import sys
import json
import glob
import subprocess
import pytesseract
from PIL import Image
from pathlib import Path

# Configuration
SCREENSHOT_DIR = Path("public/screenshot")
DATA_DIR = Path("public/data")

# Tesseract Setup
TESSERACT_CMD_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    r"C:\Users\User\AppData\Local\Programs\Tesseract-OCR\tesseract.exe",
]

def setup_tesseract():
    try:
        pytesseract.get_tesseract_version()
        return True
    except:
        pass
    for path in TESSERACT_CMD_PATHS:
        if os.path.exists(path):
            pytesseract.pytesseract.tesseract_cmd = path
            return True
    return False

# Base Parser
class BaseParser:
    def __init__(self, text, filename):
        self.text = text
        self.filename = filename

    def parse_date(self):
        # Try YYYY-MM-DD
        match = re.search(r'(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})', self.filename)
        if match:
             return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"

        # Try YY-MM-DD (assume 20xx)
        match = re.search(r'(\d{2})[-_.](\d{1,2})[-_.](\d{1,2})', self.filename)
        if match:
             return f"20{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"


        match = re.search(r'(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})', self.text)
        if match:
             return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"

        return None


    def extract_data(self):
        raise NotImplementedError

# RoundHill Parser
class RoundHillParser(BaseParser):
    OCR_CORRECTIONS = {
        'COsSWw': 'COSW',
        'GOOWw': 'GOOW',
        'COSSW': 'COSW',
        'GOOWW': 'GOOW',
        'COIw': 'COIW',
        'GOOwWw': 'GOOW',
    }

    def extract_data(self):
        results = {}
        lines = self.text.split('\n')

        # Strategy 1: Same-line format (Ticker and Amount on the same line)
        for line in lines:
            line = line.strip()
            if not line: continue
            
            # Pre-cleanup keys using OCR corrections
            for bad, good in self.OCR_CORRECTIONS.items():
                if bad in line:
                    line = line.replace(bad, good)

            if "Expense Ratio" in line or "Fee" in line:
                continue

            match = re.findall(r'\b([A-Z]{3,5})\b', line)

            # Find float with at least 4 decimals
            amount_match = re.search(r'[\$]?(\d+\.\d{4,})', line)

            if match and amount_match:
                ticker = match[-1]
                amount = float(amount_match.group(1))

                if ticker not in ["FUND", "ETF", "NAV", "DATE"]:
                    results[ticker] = amount

        # Strategy 2: Columnar format detection (Tickers in one block, Amounts in another)
        if not results:
            tickers_list = []
            amounts_list = []
            for line in lines:
                line = line.strip()
                if not line: continue
                
                if "Expense Ratio" in line or "Fee" in line:
                    continue

                # Look for distribution amount (e.g., $0.158776 or 0.158776)
                # Must have at least 4 decimals to be a valid distribution amount
                amount_match = re.search(r'^\$?(\d+\.\d{4,})$', line)
                if amount_match:
                    amounts_list.append(float(amount_match.group(1)))
                    continue

                # Look for ticker (3-6 chars, allowing for some OCR noise)
                # Roundhill tickers are usually 4 uppercase chars.
                words = line.split()
                if words:
                    # Take the first token if it's short and looks like a ticker
                    token = words[0]
                    # Apply corrections first (e.g., GOOwWw -> GOOW)
                    corrected_token = self.OCR_CORRECTIONS.get(token, token)
                    
                    # If it's a known correction, it's definitely a ticker
                    if corrected_token in self.OCR_CORRECTIONS.values():
                        tickers_list.append(corrected_token)
                        continue

                    # Otherwise, check if it looks like a valid ticker (all caps, 3-5 chars)
                    # or if it was a minor OCR mess (allow some lowercase if corrected or short)
                    if re.match(r'^[A-Za-z]{3,5}$', token):
                        ticker = token.upper()
                        # Final check against stopwords
                        if ticker not in ["FUND", "NAME", "ETF", "NAV", "DATE", "SHARE", "PER", "STOCK", "MACRO", "THE", "THEIR", "AND", "FOR"]:
                             tickers_list.append(ticker)

            # Map by position if counts match
            if len(tickers_list) == len(amounts_list) and tickers_list:
                for i in range(len(tickers_list)):
                    results[tickers_list[i]] = amounts_list[i]

        return results

# YieldMax Parser
class YieldMaxParser(BaseParser):
    # YieldMax publishes the weekly table in this order. Keeping the order in
    # one place lets us recover rows whose ticker cell is lost by OCR while
    # still pairing each value with the correct Distribution per Share row.
    # 2026-07-30 added INYY and YSPC.
    CANONICAL_WEEKLY_TICKERS = [
        'AIYY', 'AMDY', 'AMZY', 'APLY', 'BABO', 'BRKC', 'CONY',
        'CRCO', 'CRSH', 'CVNY', 'DIPS', 'DRAY', 'FBY', 'FIAT',
        'GDXY', 'GMEY', 'GOOY', 'HIYY', 'HOOY', 'INYY', 'JPO',
        'MARO', 'MRNY', 'MSFO', 'MSTY', 'NFLY', 'NVDY', 'OARK',
        'PLTY', 'PYPY', 'RBLY', 'RDYY', 'SMCY', 'SNOY', 'TSLY',
        'TSMY', 'WNTR', 'XOMO', 'XYZY', 'YSPC', 'YBIT', 'YQQQ',
    ]

    # OCR often misreads YieldMax tickers
    # Map: OCR_result → Actual_ticker (case-insensitive)
    OCR_CORRECTIONS = {
        # Direct mappings based on analysis of ocr_output.txt
        'APNY': 'ABNY', 'APNY_': 'ABNY',
        'ALYY': 'AIYY', 'AIVY': 'AIYY', 'seestegy': 'AIYY', 'AL': 'AIYY',
        'ANIPY': 'AMDY',
        'ANAZY': 'AMZY', 'ANAZY,': 'AMZY',
        'APTY': 'APLY',  # Correction: APLY (Apple), not QDTY
        'PASO': 'BABO', 'PASO,': 'BABO',
        'SAKE': 'BRKY',
        'CONY': 'CONY',
        'CRCO': 'CRCO', 'CRCO_': 'CRCO',
        'CRS': 'CRSH', 'CRS,': 'CRSH', # Short TSLA
        'EVNY': 'CVNY',
        'PS': 'DIPS', # Short NVDA
        'DISO': 'DISO',
        'PRAY': 'DRAY',
        'GAY': 'FBYY',
        'PAR': 'FIAT', # Short COIN
        'EPXY': 'GDXY',
        'EMEY': 'GMEY',
        'COOY': 'GOOY',
        'RVY': 'HIYY', 'RVY_': 'HIYY',
        'HOOY': 'HOOY',
        'JPMO': 'JPO',
        'MANO': 'MARO',
        'MARNY': 'MRNY', 'MARNY,': 'MRNY',
        'MSRO': 'MSFO',
        'MUSTY': 'MSTY', 'MUSTY:': 'MSTY',
        'NEVY': 'NFLY',
        'NVPY': 'NVDY',
        'ARK': 'OARK',
        'PLTY': 'PLTY',
        'PYPY': 'PYPY',
        'PRETY': 'RBLY',
        'AOVY': 'RDYY', 'AOVY:': 'RDYY',
        'SMCY': 'SMCY', 'SMCY_': 'SMCY',
        'SNOY': 'SNOY', 'SNOY:': 'SNOY',
        'RSTY': 'TSLY', 'RSTY,': 'TSLY',
        'TSMY': 'TSMY',
        'WWTR': 'WNTR', # Short MSTR
        'XOMO': 'XOMO',
        'WPAY': 'TOPW',
        'XYZY': 'XYZY',
        'YAR': 'YBIT',
        'YAAA': 'YQQQ', # Short N100
        
        # New corrections for 2026-02-11
        'CUPY': 'CHPY',
        'RIVY': 'FIVY',
        'GERY': 'GPTY',
        'URAY': 'LFGY',
        'OOTY': 'QDTY',
        'SPTY': 'SDTY',
        'SURY': 'SLTY',
        'UM': 'ULTY',

        # Existing/Generic corrections just in case
        'GAPY': 'CHPY',
        'PEAR': 'FEAT',
        'PIVY': 'FIVY',
        'ELEMAX': 'FIVY',  # OCR sometimes reads "pivy_" as "eleMax"
        'UPCY': 'LFGY',
        'SIRE': 'SLTY',
        'SUTY': 'SLTY',
        'WIRY': 'ULTY',
        'UTY': 'ULTY',
        'YMAG': 'YMAG',  # Sometimes correct
        'LDMAX': 'YMAG',  # OCR sometimes reads "ymag_" as "ldMax"
        'YELEIAN': 'LFGY',
        'YIN': 'YMAX',
        'VI': 'YMAX',
        'GPTY': 'GPTY',  # Sometimes correct
        'RDTY': 'RDTY',  # Sometimes correct
        'SDTY': 'SDTY',  # Sometimes correct

        # New corrections for 2026-02-12
        'AY': 'AIYY',
        'AMPY': 'AMDY',
        'ANMZY': 'AMZY',
        'APTY': 'APLY', # Overrides previous if any, identifying as Apple
        'SAKE': 'BRKY',
        'CUNY': 'CVNY',
        'PIPS': 'DIPS',
        'PISO': 'DISO', 'piso': 'DISO',
        'PRAY': 'DRAY',
        'RAY': 'FBY',
        'RAT': 'FIAT',
        'GPXY': 'GDXY',
        'AMEY': 'GMEY',
        'SPMO': 'JPO',
        'JPMO': 'JPO',
        'NANG': 'MARO',
        'MANY': 'MRNY',
        'MSRO': 'MSFO',
        'NETY': 'NFLY',
        'PURTY': 'PLTY',
        'ROVY': 'RDYY',
        'QS': 'TSLY',
        'WWE': 'WNTR',
        'XVZY': 'XYZY',
        'YERT': 'YBIT',
        'YAAQ': 'YQQQ',

        # Corrections for missing tickers (2026-02-12 debug)
        '8RKC': 'BRKC', 'BRKC': 'BRKC', 'sake' : 'BRKC',
        '0IPS': 'DIPS', 'OIPS': 'DIPS', 'DlPS': 'DIPS', 'pips': 'DIPS',
        '6DXY': 'GDXY', 'CDXY': 'GDXY', '@pxy': 'GDXY',
        'M5FO': 'MSFO',
        'M5TY': 'MSTY', 'misty': 'MSTY',
        'NELY': 'NFLY', 'nety': 'NFLY',

        # New garbled patterns from 2026-03-26 (Updated 2026-04-02)
        'ARR': 'AIYY', 'AIRR': 'AIYY',
        'AMIDY': 'AMDY', 'AMIDY,': 'AMDY',
        'ACNFRI': 'AMZY',
        'AG': 'APLY',
        'MARS': 'BABO',
        'CERE': 'BRKC', 'cere': 'BRKC',
        'CONN': 'CONY', 'CONN,': 'CONY',
        'ERCO': 'CRCO',
        'GRI': 'CRSH',
        'DIS': 'CVNY',
        'BRAY': 'DIPS', 'BRAY,': 'DIPS', # Correction for 2026-04-02
        'ay': 'DRAY', # Correction for 2026-04-02
        'FEY)': 'FBY', 'FEY': 'FBY', 'MEY': 'FBY', 'MEY,': 'FBY',
        'BOOY)': 'FIAT',
        '“IRR?': 'GDXY',
        'NOOY': 'GMEY', 'nOoY': 'GMEY',
        'IRO': 'GOOY', 'iro': 'GOOY',
        'IRR?': 'HIYY',
        'NOT': 'HOOY',
        'MANY': 'MRNY', 'MANY,': 'MRNY',
        'MERO': 'MSFO', 'Mero': 'MSFO',
        'METN': 'MSTY', 'MeTN': 'MSTY',
        'NNA?': 'NFLY', 'nna?': 'NFLY',
        'CR?': 'NVDY', 'NUDY': 'NVDY',
        'ENS': 'OARK', 'ens': 'OARK',
        'PYEN': 'PLTY', 'PYEN,': 'PLTY',
        'REIN': 'RBLY', 'REIN,': 'RBLY',
        'ROY': 'RDYY',
        'AURA': 'SMCY', 'aura': 'SMCY',
        'ENOY': 'SNOY', 'aay': 'SNOY', 'AAY': 'SNOY',
        'GARY': 'TSLY',
        'MOMO)': 'TSMY', 'MOMO': 'TSMY',
        'AR': 'WNTR',
        'AN': 'XOMO', 'an': 'XOMO',
        'YOQOO': 'YQQQ', 'YoQoo': 'YQQQ',
    }
    def extract_data(self):
        results = {}
        lines = self.text.split('\n')

        # The current YieldMax image is a wide, bordered table. With Tesseract
        # PSM 6 each visual row remains one OCR line, but several ticker cells
        # are still garbled. Amounts are read reliably and remain in table
        # order, so prefer a complete positional mapping over partial matches.
        ordered_amounts = []
        for line in lines:
            amt_match = re.search(r'(\d+\.\d{4})\b', line)
            if amt_match:
                amount = float(amt_match.group(1))
                if amount < 5.0:
                    ordered_amounts.append(amount)

        if len(ordered_amounts) == len(self.CANONICAL_WEEKLY_TICKERS):
            return dict(zip(self.CANONICAL_WEEKLY_TICKERS, ordered_amounts))

        for line in lines:
            clean_line = line.strip()
            if not clean_line: continue

            # Strategy 1: Look for line starting with ticker or corrected ticker
            parts = clean_line.split()
            valid_ticker = None
            
            if parts:
                raw_first = parts[0].replace('_', '').replace(',', '').replace(':', '').replace('|', '').replace('[', '').replace('*', '').strip()
                first_token = raw_first.upper()
                
                # Check OCR_CORRECTIONS first (case-sensitive or upper)
                if raw_first in self.OCR_CORRECTIONS:
                    valid_ticker = self.OCR_CORRECTIONS[raw_first]
                elif first_token in self.OCR_CORRECTIONS:
                    valid_ticker = self.OCR_CORRECTIONS[first_token]
                elif 2 <= len(first_token) <= 5 and first_token.isalpha():
                    if first_token not in ["YIELD", "ETF", "THE", "AND", "FOR", "SEE", "DATE", "YI", "YI_", "WEEKL", "WEEKLY"]:
                        valid_ticker = first_token

            if not valid_ticker:
                continue

            corrected_ticker = self.OCR_CORRECTIONS.get(valid_ticker, valid_ticker)

            # Look for distribution amount ($0.xxxx, §0.xxxx, 0.xxxx)
            amt_match = re.search(r'(?:\$|§)?(\d+\.\d{4})\b', clean_line)
            if amt_match:
                val = float(amt_match.group(1))
                if val < 5.0:
                    results[corrected_ticker] = val

        # Strategy 2: Columnar format / fallback using the canonical list
        if not results:
            tickers_list = []
            amounts_list = []
            
            # Known YieldMax Weekly ETF tickers in alphabetical order (as appears in table).
            # Updated 2026-07-30: INYY(INTC), YSPC 추가 -> 42종목
            stopwords = {"YIELDMAX", "ETF", "TICKER", "FUND", "DATE", "VAL", "TEST", 
                         "WEEKLY", "DAILY", "MONTHLY", "ROC", "SEC", "YIELD", "DAY",
                         "RATE", "PER", "SHARE", "WELD", "MIAN", "MELD", "MAX", 
                         "DORSEY", "WRIGHT", "OPTION", "INCOME", "ODTE", "COVERED", 
                         "CALL", "ULTRA", "SHORT", "TECH", "CRYPTO", "NAME", "FECH", 
                         "ORIG", "VELIE", "ULTA", "SHERE", "MERT", "ETFS", "WEIGHT",
                         "THE", "AND", "FOR", "SEE", "NAV", "DIST", "PAY", "REC"}
            
            seen_tickers = set()

            for line in lines:
                clean_line = line.strip()
                if not clean_line: continue
                
                amt_match = re.search(r'(?:^|\s)(?:\$|50\.|§)?(\d+\.\d{4})\b', clean_line)
                if amt_match:
                    val = float(amt_match.group(1))
                    dec = amt_match.group(1).split('.')[1]
                    if val >= 5.0 and len(dec) == 4:
                        val = float(f"0.{dec}")
                    if val < 5.0:
                        amounts_list.append(val)
                        continue
                
                words = clean_line.split()
                if words:
                    raw_token = words[0].replace('_', '').replace(',', '').replace(':', '').replace('|', '').replace('(', '').replace(')', '').replace('?', '')
                    token = raw_token.upper().replace('\u201c', '').replace('\u201d', '').replace('\u2018', '').replace('\u2019', '').replace('"', '').replace("'", '')
                    
                    corrected = self.OCR_CORRECTIONS.get(raw_token, self.OCR_CORRECTIONS.get(token, token))
                    
                    if corrected in self.OCR_CORRECTIONS.values():
                        if corrected not in seen_tickers:
                            tickers_list.append(corrected)
                            seen_tickers.add(corrected)
                    elif 2 <= len(token) <= 5 and token.isalpha():
                        if token not in stopwords and token not in seen_tickers:
                            tickers_list.append(token)
                            seen_tickers.add(token)
            
            print(f"  [i] 열 형식: {self.filename}에서 티커 {len(tickers_list)}개, 금액 {len(amounts_list)}개 감지")

            if len(amounts_list) == len(self.CANONICAL_WEEKLY_TICKERS):
                print(f"  [i] {self.filename}: 정규 {len(self.CANONICAL_WEEKLY_TICKERS)}종목 목록 사용")
                for i, ticker in enumerate(self.CANONICAL_WEEKLY_TICKERS):
                    results[ticker] = amounts_list[i]
            else:
                if len(tickers_list) != len(amounts_list):
                    print(f"  [!] {self.filename} 열 불일치: 티커 {len(tickers_list)}개 vs 금액 {len(amounts_list)}개 - 앞 {min(len(tickers_list), len(amounts_list))}개만 매핑")
                min_len = min(len(tickers_list), len(amounts_list))
                for i in range(min_len):
                    results[tickers_list[i]] = amounts_list[i]

        return results

class RexParser(BaseParser):
    # OCR often misreads REX tickers as underlying stock symbols
    # Map: OCR_result → Actual_REX_ticker
    OCR_CORRECTIONS = {
        'NVDA': 'NVII',  # REX NVDA Growth & Income ETF
        'TSLA': 'TSII',  # REX TSLA Growth & Income ETF
        'MSTR': 'MSII',  # REX MSTR Growth & Income ETF
        'COIN': 'COII',  # REX COIN Growth & Income ETF
        'HOOD': 'HOII',  # REX HOOD Growth & Income ETF
        'HOON': 'HOII',  # OCR sometimes reads HOOD as "Hoon"
        'CRWY': 'CWII',  # REX CRWY Growth & Income ETF
        'PLTR': 'PLTI',  # REX PLTR Growth & Income ETF
        'LLY': 'LLII',   # REX LLY Growth & Income ETF
        'WMT': 'WMTI',   # REX WMT Growth & Income ETF
    }
    
    def extract_data(self):
        results = {}
        lines = self.text.split('\n')

        for i, line in enumerate(lines):
            line = line.strip()
            if not line: continue

            # Strategy 1: Image-based table format
            # Extract Fund Ticker and Distribution Per Share from table rows
            # Pattern: "REX TICKER ... $0.xxxx" or "REX TICKER ... 0.xxxx"
            
            # Find ALL tickers in the line (3-4 letters)
            ticker_matches = re.findall(r'\b([A-Z]{3,4})\b', line)
            if not ticker_matches:
                continue
            
            # Filter out header words and find the actual fund ticker
            # Prioritize tickers in OCR_CORRECTIONS or 4-letter tickers
            ticker = None
            for candidate in ticker_matches:
                # Skip common header words
                if candidate in ["DATE", "RATE", "FUND", "NAME", "RISK", "HIGH", "YIELD"]:
                    continue
                # Skip "REX" itself (the fund family name)
                if candidate == "REX":
                    continue
                # This is likely the actual ticker
                ticker = candidate
                break
            
            if not ticker:
                continue
            
            # Look for distribution amount on the same line
            # Try with $ first
            amt_match = re.search(r'\$(\d+\.\d+)', line)
            if not amt_match:
                # Fallback: decimal without $ (must have 4 decimals to avoid percentages)
                amt_match = re.search(r'\b(\d+\.\d{4})\b', line)
            
            if amt_match:
                amount = float(amt_match.group(1))
                
                # Fix OCR error: sometimes leading 0 is dropped (9.0491 → 0.0491)
                # If amount > 5.0 and has 4 decimals, likely missing leading 0
                if amount > 5.0:
                    # Try replacing first digit with 0
                    amt_str = amt_match.group(1)
                    if '.' in amt_str:
                        # e.g., "9.0491" → "0.0491"
                        fixed_amt_str = '0' + amt_str[1:]
                        fixed_amount = float(fixed_amt_str)
                        if 0.001 <= fixed_amount <= 5.0:
                            amount = fixed_amount
                
                # Validate amount is in reasonable range for distributions
                if 0.001 <= amount <= 5.0:
                    # Apply OCR correction if needed
                    corrected_ticker = self.OCR_CORRECTIONS.get(ticker, ticker)
                    results[corrected_ticker] = amount
                    continue

            # Strategy 2: Text-based format (original logic)
            # REX Ticker Pattern: Line with only 4 uppercase letters
            # e.g. "NVII", "TSII". Avoids text lines.
            if re.match(r'^[A-Z]{4}$', line):
                ticker = line
                # Filter out potential false positives
                if ticker in ["DATE", "RATE", "YIELD"]:
                    continue

                # Look forward for price (e.g. "$0.2075")
                for offset in range(1, 5):
                    if i + offset >= len(lines): break
                    next_line = lines[i + offset].strip()
                    if not next_line: continue

                    # Match $0.xxxx
                    amt_match = re.match(r'^\$(\d+\.\d+)', next_line)
                    if amt_match:
                        results[ticker] = float(amt_match.group(1))
                        break
        return results


# Graniteshares Parser
class GranitesharesParser(BaseParser):
    def extract_data(self):
        results = {}
        lines = self.text.split('\n')

        for line in lines:
            line = line.strip()
            if not line: continue

            # Pattern: Ticker (first word) ... $Amount
            # Handle OCR noise: |OYY -> IOYY, _YieldBOOST -> YieldBOOST

            parts = line.split()
            if not parts: continue

            raw_ticker = parts[0]

            # Clean ticker
            clean_ticker = raw_ticker
            if '|' in clean_ticker:
                 clean_ticker = clean_ticker.replace('|', 'I')

            # Special case for QBy -> QBY
            if clean_ticker == 'QBy':
                clean_ticker = 'QBY'

            clean_ticker = clean_ticker.upper()

            # Filter: Must be 3-5 uppercase letters
            if not re.match(r'^[A-Z]{3,5}$', clean_ticker):
                continue

            # Look for $0.xxxx
            amount_match = re.search(r'\$(\d+\.\d+)', line)
            if amount_match:
                amount = float(amount_match.group(1))
                results[clean_ticker] = amount

        return results


# Defiance Parser
class DefianceParser(BaseParser):
    def extract_data(self):
        results = {}
        lines = self.text.split('\n')

        def get_ticker_from_line(line):
            line_lower = line.lower()
            line_lower = line_lower.replace('—', '').replace('@', 'q') # e.g. —@lpy -> qlpy
            
            if "r2000" in line_lower or "r200" in line_lower or "russell" in line_lower:
                return "IWMY"
            if "nasdaq 100 weekly" in line_lower or "n100 weekly" in line_lower:
                return "QQQY"
            if "s&p 500 weekly" in line_lower or "sp500 weekly" in line_lower:
                return "JEPY"
            if "gold" in line_lower:
                return "GLDY"
            if "oil" in line_lower:
                return "USOY"
            if "lightningspread" in line_lower or "lightning spread" in line_lower or "qldy" in line_lower or "lpy" in line_lower:
                return "QLDY"
            if "nasdaq 100 income" in line_lower or "qqqt" in line_lower:
                return "QQQT"
            if "s&p 500 income" in line_lower or "spyt" in line_lower or "tnammd" in line_lower:
                return "SPYT"
            if "mstr" in line_lower or "mst" in line_lower or "mets" in line_lower:
                return "MST"
            if "ybmn" in line_lower or "bmnr" in line_lower or "beene" in line_lower:
                return "YBMN"
            if "wdte" in line_lower:
                return "WDTE"
            return None

        def extract_amount_from_line(line):
            line_clean = re.sub(r'\b\d+(?:\.\d+)?%', '', line)
            line_clean = re.sub(r'\b\d{2}[-_./]\d{2}[-_./]\d{4}\b', '', line_clean)
            
            float_matches = re.findall(r'\$?(\d+\.\d+)', line_clean)
            for m in float_matches:
                val = float(m)
                if 0.01 <= val <= 2.0:
                    return val
                    
            digit_matches = re.findall(r'\b(\d{4,5})\b', line_clean)
            if not digit_matches:
                digit_matches = re.findall(r'(\d{4,5})', line_clean)
                
            for m in digit_matches:
                if m in ["100", "500", "2000", "2024", "2025", "2026", "2027"]:
                    continue
                if len(m) == 5 and m.startswith('9'):
                    val = float('0.' + m[1:])
                    if 0.01 <= val <= 2.0:
                        return val
                elif len(m) == 4:
                    val = float('0.' + m)
                    if 0.01 <= val <= 2.0:
                        return val
            return None

        current_ticker = None
        tickers_list = []
        amounts_list = []

        # Strategy 1: Inline & Interleaved Extraction
        for line in lines:
            line = line.strip()
            if not line:
                continue

            ticker = get_ticker_from_line(line)
            if ticker:
                current_ticker = ticker
                if ticker not in tickers_list:
                    tickers_list.append(ticker)

            amount = extract_amount_from_line(line)
            if amount is not None:
                amounts_list.append(amount)
                if current_ticker:
                    results[current_ticker] = amount
                    current_ticker = None

        # Strategy 2: Columnar format mapping (if len(tickers_list) == len(amounts_list))
        if (not results or len(results) < len(tickers_list)) and len(tickers_list) == len(amounts_list) and tickers_list:
            results = {}
            for i in range(len(tickers_list)):
                results[tickers_list[i]] = amounts_list[i]

        return results


# Neos Parser
class NeosParser(BaseParser):
    def extract_data(self):
        results = {}
        lines = self.text.split('\n')

        # NEOS distribution announcements often have Tickers as standalone lines,
        # or followed by their name, then the amount on another line or same line.
        
        # Valid Neos tickers are usually 4 or 5 uppercase characters.
        # Examples from screenshot: SPYI, QQQI, IWMI, NIHI, BTCI, NEHI, IYRI, IAUI, MLPI, XSPI, XQQI, XBCI, QQQH, SPYH, NLSI, HYBI, BNDI, TLTI, CSHI
        
        current_ticker = None
        for line in lines:
            line = line.strip()
            if not line: continue

            # Pattern for Ticker: standalone 4-5 uppercase chars that aren't common words
            ticker_match = re.search(r'\b([A-Z]{4,5})\b', line)
            
            # Pattern for amount: $0.xxxx (at least 4 decimals)
            amount_match = re.search(r'\$?(\d+\.\d{4,})', line)

            if ticker_match and not amount_match:
                candidate = ticker_match.group(1)
                # Exclusion list for non-tickers
                if candidate not in ["NEOS", "FUND", "DATE", "RATE", "YIELD", "DIST", "NAV", "PAY", "REC", "TEST", "NET", "ASSET", "ROC", "MONTH", "YEAR", "HIGH", "BOND", "MARKET", "DAILY", "SHARE", "TOTAL", "MSCI", "EAFE", "GOLD", "STOK", "BOND", "MARKET"]:
                    current_ticker = candidate

            if amount_match:
                amount = float(amount_match.group(1))
                if ticker_match:
                    results[ticker_match.group(1)] = amount
                    current_ticker = None
                elif current_ticker:
                    results[current_ticker] = amount
                    current_ticker = None

        return results


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
            return False

        for entry in target_list:
            if entry.get('date') == date_str:
                if entry.get('expected') == True:
                    del entry['expected']
                    entry['amountFixed'] = amount
                    updated = True
                    print(f"  [+] {path.name} 업데이트됨: {date_str} → {amount}")
                elif 'amountFixed' in entry:
                     # Skip overwriting existing values
                     if abs(entry['amountFixed'] - amount) > 0.0001:
                         print(f"  [!] {path.name} 건너뜀: {date_str}에 이미 {entry['amountFixed']} 존재 (새 값: {amount})")

        if updated:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            # Format with Prettier
            try:
                subprocess.run(["npx", "prettier", "--write", str(path)], shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print(f"  [+] {path.name} Prettier 포매팅 완료")
            except Exception as fmt_err:
                print(f"  [!] {path.name} 포매팅 오류: {fmt_err}")

            return True

    except Exception as e:
        print(f"  [!] {path} 읽기/쓰기 오류: {e}")

    return False

def main():
    if not setup_tesseract():
        sys.exit(1)

    image_files = list(SCREENSHOT_DIR.glob("*.webp")) + list(SCREENSHOT_DIR.glob("*.jpg")) + list(SCREENSHOT_DIR.glob("*.png")) + list(SCREENSHOT_DIR.glob("*.txt"))

    for img_path in image_files:
        print(f"\n{img_path.name} 처리 중...")
        try:
            if img_path.suffix.lower() == ".txt":
                with open(img_path, "r", encoding="utf-8") as f:
                    text = f.read()
            else:
                # YieldMax uses a single wide table. PSM 6 preserves its visual
                # row order for reliable ticker/value pairing.
                ocr_config = "--psm 6" if "yieldmax" in img_path.name.lower() else ""
                text = pytesseract.image_to_string(Image.open(img_path), config=ocr_config)
        except Exception as e:
            print(f"  [!] {img_path.name} 이미지 읽기/처리 실패: {e}")
            continue

        # Debug: Save OCR output to file
        try:
            with open("ocr_debug.txt", "a", encoding="utf-8") as f:
                f.write(f"\n--- {img_path.name} ---\n")
                f.write(text)
                f.write("\n" + "="*30 + "\n")
        except Exception as e:
            print(f"  [!] 디버그 로그 쓰기 실패: {e}")

        parser_type = None
        if "roundhill" in img_path.name.lower():
            parser_type = RoundHillParser
        elif "yieldmax" in img_path.name.lower():
            parser_type = YieldMaxParser
        elif "rex" in img_path.name.lower():
            parser_type = RexParser
        elif "graniteshares" in img_path.name.lower():
            parser_type = GranitesharesParser
        elif "defiance" in img_path.name.lower():
            parser_type = DefianceParser
        elif "neos" in img_path.name.lower():
            parser_type = NeosParser
        else:
            continue

        parser = parser_type(text, img_path.name)
        date_str = parser.parse_date()

        if not date_str: continue
        print(f"  날짜: {date_str}")

        data_map = parser.extract_data()
        for ticker, amount in data_map.items():
            json_path = find_json_path(ticker)
            if json_path:
                update_json(json_path, date_str, amount)

if __name__ == "__main__":
    main()
