#!/usr/bin/env python3
"""Local KIS historical-trade export. Python 3.10+, standard library only.

Only OAuth token issuance and GET inquire-period-trans are implemented.
No credentials are written to disk. No order, transfer, or FX endpoint exists.
"""
import argparse
import calendar
import csv
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import sys
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPSHandler, HTTPRedirectHandler
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

BASE = "https://openapi.koreainvestment.com:9443"
PATH = "/uapi/overseas-stock/v1/trading/inquire-period-trans"
LABELS = {
    "account": "계좌(마스킹)", "market": "조회시장", "query_from": "조회시작",
    "query_to": "조회종료", "page": "페이지", "trad_dt": "매매일자",
    "sttl_dt": "결제일자", "sll_buy_dvsn_cd": "매도매수코드",
    "sll_buy_dvsn_name": "매도매수", "pdno": "종목코드",
    "ovrs_item_name": "종목명", "ccld_qty": "체결수량",
    "amt_unit_ccld_qty": "금액단위체결수량", "ft_ccld_unpr2": "FT체결단가",
    "ovrs_stck_ccld_unpr": "해외주식체결단가", "tr_frcr_amt2": "거래외화금액",
    "tr_amt": "거래금액", "frcr_excc_amt_1": "외화정산금액",
    "wcrc_excc_amt": "원화정산금액", "dmst_frcr_fee1": "국내외화수수료",
    "frcr_fee1": "외화수수료", "dmst_wcrc_fee": "국내원화수수료",
    "ovrs_wcrc_fee": "해외원화수수료", "crcy_cd": "통화",
    "erlm_exrt": "등록환율", "std_pdno": "표준상품번호",
}


class ExportError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ExportError("예상치 못한 리디렉션을 중단했습니다.")


def mask(account):
    return "****" + account[-7:]


def parse_date(value):
    return date.fromisoformat(value)


def read_local_env(path):
    """Read four literal local values; never execute shell syntax or change os.environ."""
    allowed = {"KIS_APP_KEY", "KIS_APP_SECRET", "KIS_CANO", "KIS_ACNT_PRDT_CD"}
    if not path.exists():
        if Path(str(path) + ".txt").exists():
            raise ExportError("설정 파일 이름 끝에 .txt가 붙었습니다. 파일 확장명을 표시하고 .txt를 제거하세요.")
        return {}
    try:
        content = path.read_text(encoding="utf-8-sig")
    except UnicodeError:
        raise ExportError("로컬 설정 파일을 UTF-8로 다시 저장하세요. UTF-8 BOM도 지원합니다.") from None
    result = {}
    for index, line in enumerate(content.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or key not in allowed:
            raise ExportError(f"로컬 설정 {index}번째 줄 형식/변수명이 올바르지 않습니다. 값은 출력하지 않았습니다.")
        if key in result:
            raise ExportError(f"로컬 설정 변수 {key}가 중복되었습니다.")
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise ExportError(f"로컬 설정 {index}번째 줄의 따옴표를 확인하세요.")
            value = value[1:-1]
        result[key] = value
    return result


def configured_accounts(config):
    cano = config.get("KIS_CANO", "").strip()
    product = config.get("KIS_ACNT_PRDT_CD", "").strip()
    if not cano and not product:
        return []
    if not re.fullmatch(r"\d{8}", cano) or not re.fullmatch(r"\d{2}", product):
        raise ExportError("KIS_CANO는 계좌 앞 8자리, KIS_ACNT_PRDT_CD는 확인한 뒤 2자리를 함께 입력하세요. 상품코드는 추측하지 않습니다.")
    return [cano + "-" + product]


def months(start, end):
    while start <= end:
        stop = min(end, date(start.year, start.month, calendar.monthrange(start.year, start.month)[1]))
        yield start, stop
        start = stop + timedelta(days=1)


def window_plan(start, end, full):
    if full:
        if start is None:
            raise ExportError("전체 기간 조회에는 근거를 확인한 시작 경계(--start)가 필요합니다. 최초 거래일을 추측하지 않습니다.")
        return list(months(start, end))
    # Old-period support, ordinary trades, and known ministock trades are separate probes.
    chosen = []
    selected = [(date(2024, 12, 1), date(2024, 12, 31)),
                (date(2025, 5, 1), date(2025, 5, 31))]
    if start:
        selected.append((start, date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])))
    else:
        selected.append((date(end.year, end.month, 1), end))
    for a, b in selected:
        a, b = max(a, start or a), min(b, end)
        if a <= b and (a, b) not in chosen:
            chosen.append((a, b))
    return chosen


class Client:
    def __init__(self, key, secret):
        self.key, self.secret, self.token = key, secret, ""
        self.hidden = [key, secret]
        self.opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
        self.last_request = 0.0
        self.last_response_text = ""

    def safe(self, value):
        text = str(value)
        for item in self.hidden:
            if item:
                text = text.replace(item, "[비공개]")
        text = re.sub(r"\b\d{8}-?\d{2}\b", "[계좌번호]", text)
        return text[:350]

    def request(self, path, params, tr_cont=""):
        if path not in ("/oauth2/tokenP", PATH):
            raise ExportError("허용되지 않은 API 경로입니다.")
        time.sleep(max(0, 0.6 - (time.monotonic() - self.last_request)))
        headers = {"content-type": "application/json; charset=utf-8"}
        if path == "/oauth2/tokenP":
            request = Request(BASE + path, data=json.dumps(params).encode(), headers=headers, method="POST")
        else:
            headers.update(authorization="Bearer " + self.token, appkey=self.key,
                           appsecret=self.secret, tr_id="CTOS4001R", custtype="P", tr_cont=tr_cont)
            request = Request(BASE + path + "?" + urlencode(params), headers=headers, method="GET")
        self.last_request = time.monotonic()
        try:
            with self.opener.open(request, timeout=40) as response:
                raw = response.read().decode("utf-8-sig")
                body = json.loads(raw, parse_float=str, parse_int=str)
                if not isinstance(body, dict):
                    raise ExportError("API 응답 형식이 예상과 다릅니다.")
                if path == PATH:
                    self.last_response_text = raw
                return {k.lower(): v for k, v in response.headers.items()}, body
        except HTTPError as exc:
            # Never print raw request URLs, headers, response bodies, or credentials.
            try:
                body = json.loads(exc.read().decode("utf-8"))
                message = self.safe(body.get("msg1", body.get("error_description", "")))
            except (ValueError, UnicodeError, AttributeError):
                message = "응답 본문은 출력하지 않았습니다."
            raise ExportError(f"HTTP {exc.code}: {message}") from None
        except (URLError, TimeoutError, OSError) as exc:
            raise ExportError(f"네트워크 연결 오류: {type(exc).__name__}") from None
        except (ValueError, UnicodeError):
            raise ExportError("JSON 응답을 해석하지 못했습니다.") from None

    def authenticate(self):
        _, body = self.request("/oauth2/tokenP", {
            "grant_type": "client_credentials", "appkey": self.key, "appsecret": self.secret})
        token = body.get("access_token")
        if not isinstance(token, str) or not token:
            raise ExportError("인증 실패: " + self.safe(body.get("error_description", body.get("msg1", "토큰 없음"))))
        self.token = token
        self.hidden.append(token)

    def get_page(self, account, market, start, end, fk, nk, cont):
        self.hidden.extend([account, account.replace("-", ""), account[:8]])
        headers, body = self.request(PATH, {
            "CANO": account[:8], "ACNT_PRDT_CD": account[-2:],
            "ERLM_STRT_DT": start.strftime("%Y%m%d"), "ERLM_END_DT": end.strftime("%Y%m%d"),
            "OVRS_EXCG_CD": market, "PDNO": "", "SLL_BUY_DVSN_CD": "00",
            "LOAN_DVSN_CD": "", "CTX_AREA_FK100": fk, "CTX_AREA_NK100": nk,
        }, cont)
        if str(body.get("rt_cd")) != "0":
            raise ExportError(self.safe(body.get("msg_cd", "")) + ": " + self.safe(body.get("msg1", "조회 실패")))
        return headers, body


def fetch_window(client, account, market, start, end, on_page, max_pages=10000, checkpoint=None):
    checkpoint = checkpoint or {}
    fk, nk = checkpoint.get("fk", ""), checkpoint.get("nk", "")
    first = int(checkpoint.get("next_page", 1))
    cont = "N" if first > 1 else ""
    seen = {tuple(pair) for pair in checkpoint.get("seen", [])}
    for page in range(first, max_pages + 1):
        headers, body = client.get_page(account, market, start, end, fk, nk, cont)
        if "output1" not in body:
            raise ExportError("거래 목록(output1)이 없는 응답입니다. 빈 내역으로 처리하지 않았습니다.")
        rows = body["output1"]
        if rows is None or rows == "":
            rows = []
        elif isinstance(rows, dict):
            rows = [rows] if rows else []
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ExportError("거래 목록 구조가 예상과 다릅니다.")
        if "tr_cont" not in headers:
            on_page(page, rows, body, "", None)
            raise ExportError("연속조회 헤더가 없어 마지막 페이지 여부를 확인하지 못했습니다.")
        flag = headers.get("tr_cont", "").strip().upper()
        terminal = flag in ("", "D", "E")
        if not terminal and flag not in ("M", "F"):
            on_page(page, rows, body, flag, None)
            raise ExportError("알 수 없는 연속조회 상태: " + flag)
        new_fk = str(body.get("ctx_area_fk100", "")).strip()
        new_nk = str(body.get("ctx_area_nk100", "")).strip()
        cursor = new_fk, new_nk
        if not terminal and (not any(cursor) or cursor in seen):
            on_page(page, rows, body, flag, None)
            raise ExportError("연속조회 키가 비었거나 반복됩니다. 해당 구간은 미완료입니다.")
        if not terminal:
            seen.add(cursor)
        next_checkpoint = {"fk": new_fk, "nk": new_nk, "next_page": page + 1,
                           "seen": sorted(seen), "terminal": terminal}
        on_page(page, rows, body, flag, next_checkpoint)
        if terminal:
            return
        fk, nk, cont = new_fk, new_nk, "N"
    raise ExportError("페이지 보호 한도에 도달했습니다. 전체 완료로 처리하지 않았습니다.")


def columns(rows):
    return list(dict.fromkeys(key for row in rows for key in row)) or ["안내"]


def csv_value(value):
    value = str(value)
    if value.lstrip().startswith(("=", "+", "-", "@")) and not re.fullmatch(r"[+-]?\d+(\.\d+)?", value):
        return "'" + value
    return value


def write_csv(path, rows):
    fields = columns(rows)
    with path.open("w", encoding="utf-8-sig", newline="") as out:
        writer = csv.writer(out)
        writer.writerow([LABELS.get(k, k) for k in fields])
        for row in rows:
            writer.writerow([csv_value(row.get(k, "")) for k in fields])


def xlsx(path, sheets):
    # Text cells preserve fractional quantities, identifiers, and original decimal precision.
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    with ZipFile(path, "w", ZIP_DEFLATED) as book:
        book.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?>'
                      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                      '<Default Extension="xml" ContentType="application/xml"/>'
                      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                      + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets)+1)) + '</Types>')
        book.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                      f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        book.writestr("xl/workbook.xml", f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets>'
                      + ''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, _) in enumerate(sheets, 1)) + '</sheets></workbook>')
        book.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                      + ''.join(f'<Relationship Id="rId{i}" Type="{rel}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets)+1)) + '</Relationships>')
        for i, (_, rows) in enumerate(sheets, 1):
            fields = columns(rows)
            data = [[LABELS.get(k, k) for k in fields]] + [[str(r.get(k, "")) for k in fields] for r in rows]
            if len(data) > 1048576:
                raise ExportError("엑셀 행 한도를 넘었습니다. JSON/CSV를 사용하세요.")
            with book.open(f"xl/worksheets/sheet{i}.xml", "w") as sheet:
                sheet.write(f'<worksheet xmlns="{ns}"><sheetData>'.encode())
                for number, row in enumerate(data, 1):
                    text = f'<row r="{number}">'
                    for value in row:
                        clean = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)
                        text += '<c t="inlineStr"><is><t xml:space="preserve">' + escape(clean) + '</t></is></c>'
                    sheet.write((text + '</row>').encode())
                sheet.write(b'</sheetData></worksheet>')


def number(value):
    try:
        return Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        return None


def atomic_json(path, payload):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def account_id(account):
    return hashlib.sha256(account.encode()).hexdigest()[:16]


def load_observations(folder):
    rows = []
    for file in sorted(folder.glob("page_*.json")):
        payload = json.loads(file.read_text(encoding="utf-8"))
        for index, record in enumerate(payload["response"]["output1"] or [], 1):
            canonical = json.dumps(record, sort_keys=True, ensure_ascii=False)
            fingerprint = hashlib.sha256((payload["query"]["account_id"] + canonical).encode()).hexdigest()
            rows.append({**record, **payload["query"], "page": str(payload["page"]),
                         "observation_id": file.stem + ":" + str(index), "record_fingerprint": fingerprint})
    return rows


def reference_checks(rows, windows, reference_path, start, end):
    if not reference_path.exists():
        return [{"상태": "표본 파일 없음. 미니스탁 및 과거 이력 포함 여부 확인 필요"}]
    with reference_path.open(encoding="utf-8-sig", newline="") as source:
        refs = list(csv.DictReader(source))
    accounts = {w["account"] for w in windows}
    result = []
    for ref in refs:
        if ref["account"] not in accounts or not (start or date.min) <= date.fromisoformat(ref["date"]) <= end:
            continue
        date_key = ref["date"].replace("-", "")
        candidates = []
        for row in rows:
            dates = [re.sub(r"\D", "", str(row.get(key, ""))) for key in ("trad_dt", "sttl_dt")]
            if row.get("account") != ref["account"] or date_key not in dates:
                continue
            if str(row.get("sll_buy_dvsn_cd", "")).zfill(2) != ref["side"]:
                continue
            if not any(number(row.get(key, "")) == number(ref["qty"]) for key in ("ccld_qty", "amt_unit_ccld_qty")):
                continue
            candidates.append(row)
        expected_name = re.sub(r"\W", "", ref["name"]).casefold()
        name_match = any(expected_name == re.sub(r"\W", "", str(r.get("ovrs_item_name", ""))).casefold() for r in candidates)
        covered = any(w["account"] == ref["account"] and w["query_from"] <= ref["date"] <= w["query_to"] for w in windows)
        state = ("표본 일자·종목명·수량 일치" if name_match else
                 "일자·수량 후보 있음: 종목 확인 필요" if candidates else
                 "표본 미발견: 날짜 기준/계좌/API 지원 여부 확인" if covered else "확인용 조회 범위 밖")
        result.append({"account": ref["account"], "분류": ref["group"], "표본일자": ref["date"],
                       "표본종목": ref["name"], "표본수량": ref["qty"], "표본매도매수": ref["side"],
                       "대조결과": state, "API후보종목": "; ".join(str(r.get("ovrs_item_name", r.get("pdno", ""))) for r in candidates)})
    return result or [{"상태": "이 계좌/기간의 첨부 표본 없음. 별도 원장 대조 필요"}]


def save_result(folder, rows, windows, checks, mode, coverage=None):
    summary = [{"항목": "실행종류", "내용": mode},
               {"항목": "API 요청", "내용": "일부 미완료" if any(w["status"] != "응답종료" for w in windows) else "계획한 구간의 응답종료 확인"},
               {"항목": "전체 이력 완전성", "내용": "미확정: 응답종료/0건은 과거 전체 기록 제공을 보장하지 않음"},
               {"항목": "미니스탁 포함", "내용": "표본대조 시트와 증권사 원장으로 확인 필요"},
               {"항목": "환전/입출금/배당/출고", "내용": "이 수집기는 매수·매도 일별거래 조회용. 별도 자료 필요"},
               {"항목": "숫자 정밀도", "내용": "엑셀은 모든 값을 텍스트로 보존. JSON이 원본 값 기준"}]
    summary.append({"항목": "중복/변경 관측", "내용": "행을 삭제/병합하지 않음. observation_id로 원문 연결, record_fingerprint로 동일 내용 후보 확인. 같은 내용도 별개 거래일 수 있음"})
    if coverage:
        summary.extend([{"항목": "수집 목표", "내용": coverage["goal"]},
                        {"항목": "계좌 최초 거래일", "내용": "미확인. 최초 반환 거래/빈 과거 응답으로 판단하지 않음"},
                        {"항목": "확인 필요한 공백", "내용": " / ".join(coverage["gaps"])}])
    tables = [("거래내역", rows), ("조회구간", windows), ("표본대조", checks), ("확인사항", summary)]
    for name, data in tables:
        write_csv(folder / (name + ".csv"), data)
    (folder / "records.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "report.json").write_text(json.dumps({"summary": summary, "coverage": coverage,
        "windows": windows, "checks": checks}, ensure_ascii=False, indent=2), encoding="utf-8")
    xlsx(folder / "해외주식_거래내역.xlsx", tables)


def main():
    parser = argparse.ArgumentParser(description="KIS 해외주식 거래내역 로컬 수집 (초기값: 확인용 조회)")
    parser.add_argument("--goal", choices=["full-history", "period"], default="full-history", help="전체 이력 목표(기본) / 명시한 기간만 수집")
    parser.add_argument("--start", type=parse_date, help="공식 조회 하한 또는 계좌 증빙 등으로 확인한 요청 시작 경계. 최초 거래일로 단정하지 않음")
    parser.add_argument("--end", default=datetime.now(timezone(timedelta(hours=9))).date(), type=parse_date, help="종료일 (기본: 실행일 한국시간)")
    parser.add_argument("--start-basis", default="미확인", help="시작 경계를 정한 근거 (키/개인정보를 적지 마세요)")
    parser.add_argument("--market", default="NASD", choices=["NASD", "NYSE", "AMEX", "SEHK", "SHAA", "SZAA", "TKSE", "HASE", "VNSE"])
    parser.add_argument("--full", action="store_true", help="지정기간 전체를 월 단위 조회")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "results")
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parent / ".env.kis-orders.local", help="PC에 있는 로컬 설정 파일 (업로드하지 않음)")
    parser.add_argument("--reference", type=Path, default=Path(__file__).resolve().parent / "private" / "reference_trades.csv", help="첨부 거래내역에서 추출한 로컬 표본 CSV")
    parser.add_argument("--resume", type=Path, help="기존 실행 결과 폴더에서 이어받기 (만료된 연속키는 --restart-window와 함께 사용)")
    parser.add_argument("--restart-window", action="store_true", help="재개 시 미완료 월을 첫 페이지부터 다시 조회. 이전 관측도 모두 보존")
    args = parser.parse_args()
    state = None
    if args.resume:
        state = json.loads((args.resume / "state.json").read_text(encoding="utf-8"))
        if state.get("schema") != 2:
            raise ExportError("지원하지 않는 재개 파일입니다.")
        args.start, args.end = parse_date(state["start"]) if state["start"] else None, parse_date(state["end"])
        args.market, args.full = state["market"], state["full"]
        args.goal, args.start_basis = state["goal"], state["start_basis"]
        if args.market not in parser._option_string_actions["--market"].choices:
            raise ExportError("재개 파일의 시장 코드가 올바르지 않습니다.")
    if args.start and args.start > args.end:
        parser.error("시작일이 종료일보다 늦습니다.")
    if (args.full or args.goal == "period") and args.start is None:
        parser.error("시작 경계가 미확인입니다. 기본 확인용 조회로 지원 범위를 조사한 뒤 --start를 지정하세요. 임의 연도는 넣지 않습니다.")
    print("한국투자증권 해외주식 일별거래내역 / 실전 계좌 조회")
    print("기본 시장 NASD=미국. 다른 시장은 --market으로 별도 실행하세요.")
    print("키와 토큰을 새로 저장하지 않습니다. 기존 로컬 설정/환경변수 또는 화면 비표시 입력을 사용합니다.")
    print("키는 한국투자증권 인증/조회 요청에만 사용합니다.")
    print("오래된 기록 및 미니스탁 지원은 미확정입니다. 빈 응답을 거래 없음으로 단정하지 마세요.")
    mode = "명시한 경계 내 월별 조회" if args.full else "확인용 조회 (증빙이 있는 월 + 지정 시작 월 또는 현재 월)"
    print("수집목표:", "계좌 최초 거래부터 현재까지 전체" if args.goal == "full-history" else "명시한 기간")
    print("요청 시작경계:", args.start or "미확인 (임의 시작 연도 없음)", "/ 종료:", args.end, "/", mode)
    if not args.full:
        print("먼저 확인용 실행입니다. 월별 수집은 근거를 확인한 --start와 --full을 함께 사용하세요.")
    file_config = read_local_env(args.env_file)
    config = {k: os.environ.get(k) or file_config.get(k, "") for k in
              ("KIS_APP_KEY", "KIS_APP_SECRET", "KIS_CANO", "KIS_ACNT_PRDT_CD")}
    accounts = configured_accounts(config)
    if not accounts:
        if not sys.stdin.isatty():
            raise ExportError("로컬 설정에 계좌 앞 8자리와 확인한 상품코드를 입력하거나 PC 터미널에서 실행하세요.")
        text = input("조회할 계좌번호(8자리-2자리), 여러 개는 쉼표 구분: ").strip()
        accounts = list(dict.fromkeys(a.strip() for a in text.split(",")))
    if not accounts or any(not re.fullmatch(r"\d{8}-\d{2}", a) for a in accounts):
        raise ExportError("계좌번호 형식은 12345678-01입니다. 실제 번호는 본인 PC에만 입력하세요.")
    if state and sorted(state["accounts"]) != sorted(account_id(a) for a in accounts):
        raise ExportError("재개할 때는 최초 실행과 같은 계좌들을 입력해야 합니다.")
    if (not config["KIS_APP_KEY"] or not config["KIS_APP_SECRET"]) and not sys.stdin.isatty():
        raise ExportError("로컬 설정의 실전 앱키/시크릿이 비어 있습니다. 본인 PC에서 입력하세요.")
    key = config["KIS_APP_KEY"] or getpass.getpass("실전 App Key (화면에 표시되지 않음): ").strip()
    secret = config["KIS_APP_SECRET"] or getpass.getpass("실전 App Secret (화면에 표시되지 않음): ").strip()
    if not key or not secret:
        raise ExportError("실전용 앱키와 시크릿이 필요합니다.")
    client = Client(key, secret)
    print("인증 중… (접근토큰 발급 제한이 있으므로 실행을 연속 반복하지 마세요.)")
    client.authenticate()
    folder = args.resume or args.output / datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    if not state:
        folder.mkdir(parents=True, exist_ok=False)
        windows = [{"account": mask(a), "account_id": account_id(a), "market": args.market,
                    "query_from": str(s), "query_to": str(e), "pages": 0, "rows": 0,
                    "status": "미실행", "error": "", "checkpoint": {}}
                   for a in accounts for s, e in window_plan(args.start, args.end, args.full)]
        state = {"schema": 2, "start": str(args.start) if args.start else None, "end": str(args.end), "market": args.market,
                 "goal": args.goal, "start_basis": args.start_basis, "full": args.full,
                 "accounts": [account_id(a) for a in accounts], "windows": windows}
        atomic_json(folder / "state.json", state)
    windows = state["windows"]
    account_lookup = {account_id(a): a for a in accounts}
    interrupted = False
    try:
        for status in windows:
            if status["status"] == "응답종료":
                continue
            account = account_lookup[status["account_id"]]
            start, end = parse_date(status["query_from"]), parse_date(status["query_to"])
            info = {k: status[k] for k in ("account", "account_id", "market", "query_from", "query_to")}
            if args.restart_window:
                status["checkpoint"] = {}
            status["status"], status["error"] = "미완료", ""
            atomic_json(folder / "state.json", state)
            def on_page(page, batch, body, flag, checkpoint):
                # Each response is an immutable observation, including repeat or changed pages.
                payload = {"query": info, "page": page, "continuation": flag,
                           "response": {**body, "output1": batch},
                           "raw_response_text": client.last_response_text}
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                target = folder / f"page_{account_id(account)}_{start}_{end}_p{page:05d}_{stamp}.json"
                atomic_json(target, payload)
                status["pages"] += 1
                status["rows"] += len(batch)
                if checkpoint:
                    status["checkpoint"] = checkpoint
                    status["status"] = "응답종료" if checkpoint["terminal"] else "미완료"
                atomic_json(folder / "state.json", state)
            print(mask(account), start, "~", end, end=" … ", flush=True)
            try:
                fetch_window(client, account, args.market, start, end, on_page,
                             checkpoint=status["checkpoint"])
                print(status["rows"], "관측 행 /", status["pages"], "응답 페이지")
            except ExportError as exc:
                status["status"], status["error"] = "미완료", client.safe(exc)
                atomic_json(folder / "state.json", state)
                print("미완료:", status["error"])
                # Stop all further requests on auth, quota, unsupported-history or network errors.
                interrupted = True
                break
    except KeyboardInterrupt:
        interrupted = True
        print("\n중단했습니다. 수신한 페이지를 보존합니다.")
    rows = load_observations(folder)
    checks = reference_checks(rows, windows, args.reference, args.start, args.end)
    report_windows = [{k: v for k, v in w.items() if k != "checkpoint"} for w in windows]
    gaps = ["계좌 최초 거래일 미검증", "API 최대 과거 지원 범위/요청 구간 한도 미확인", "미니스탁 전체 거래 포함 여부 미확인"]
    if args.start is None:
        gaps.append("요청 시작 경계 미확인: 오래된 이력의 수집 공백을 평가할 근거 필요")
    if not args.full:
        gaps.append("확인용 월만 조회: 다른 기간 미수집")
    if any(w["status"] != "응답종료" for w in windows):
        gaps.append("미실행 또는 미완료 조회 구간 있음")
    returned_dates = sorted(str(r.get("trad_dt", "")) for r in rows if re.fullmatch(r"\d{8}", str(r.get("trad_dt", ""))))
    coverage = {"goal": args.goal, "requested_start": state["start"], "requested_end": str(args.end),
                "start_basis": args.start_basis, "earliest_returned_trade_date": returned_dates[0] if returned_dates else None,
                "account_first_trade_verified": False, "ministock_full_coverage_verified": False,
                "api_oldest_supported_date": None, "gaps": gaps}
    save_result(folder, rows, report_windows, checks, mode, coverage)
    print("저장 위치:", folder.resolve())
    print("API 응답 건수:", len(rows), "/ 전체 과거 이력 및 미니스탁 완전성은 표본과 원장 대조 필요")
    return 1 if interrupted or any(w["status"] != "응답종료" for w in windows) else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ExportError, EOFError) as exc:
        print("실행 중단:", str(exc), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n취소했습니다.", file=sys.stderr)
        sys.exit(130)
    except (OSError, ValueError, KeyError):
        print("파일을 읽거나 저장하지 못했습니다. 기존 page_*.json 원문은 삭제하지 마세요.", file=sys.stderr)
        sys.exit(1)
