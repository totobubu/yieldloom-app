"""Authenticated Toss statement import. PDF bytes and passwords are never persisted."""
import hashlib
import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import auth, credentials, firestore
from flask import Flask, jsonify, request

from toss_extractor import extract_transactions_from_pdf

app = Flask(__name__)
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def firebase_db():
    if not firebase_admin._apps:
        raw = os.environ.get("FIRESTORE_SA_KEY")
        if not raw:
            raise RuntimeError("FIRESTORE_SA_KEY is not configured")
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw)))
    return firestore.client()


def reject(message, status=400):
    return jsonify({"error": message}), status


def transaction_type(value):
    value = str(value or "")
    if "매수" in value or "buy" in value.lower():
        return "buy"
    if "매도" in value or "sell" in value.lower():
        return "sell"
    if "배당" in value or "dividend" in value.lower():
        return "dividend"
    return "unknown"


def number(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def normalized_date(value):
    raw = str(value or "").replace(".", "").replace("-", "")
    return raw if len(raw) == 8 and raw.isdigit() else None


def stable_id(item):
    fields = ["toss-pdf", item["code"], item["date"], item["rawType"], item.get("quantity"), item.get("amount")]
    return hashlib.sha256("|".join(map(str, fields)).encode()).hexdigest()[:32]


def get_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        return auth.verify_id_token(header[7:])
    except Exception:
        return None


@app.post("/api/portfolio-import")
def import_portfolio():
    if request.content_length and request.content_length > MAX_UPLOAD_BYTES:
        return reject("PDF 파일은 20MB 이하만 업로드할 수 있습니다.", 413)
    try:
        db = firebase_db()
    except Exception:
        return reject("거래내역 저장 서비스를 준비하지 못했습니다.", 503)
    claims = get_user()
    if not claims:
        return reject("로그인이 확인되지 않았습니다.", 401)
    uploaded = request.files.get("file")
    password = request.form.get("password", "")
    if not uploaded or not uploaded.filename.lower().endswith(".pdf"):
        return reject("토스 거래내역 PDF를 선택해 주세요.")
    if not password:
        return reject("PDF 비밀번호를 입력해 주세요.")

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            temp_path = handle.name
            uploaded.save(handle)
        raw_transactions = extract_transactions_from_pdf(temp_path, verbose=False, password=password)
    except Exception:
        return reject("PDF를 열지 못했습니다. 비밀번호와 파일을 확인해 주세요.")
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

    items = []
    for raw in raw_transactions:
        code, date = raw.get("ticker"), normalized_date(raw.get("date"))
        if not code or not date:
            continue
        items.append({
            "code": str(code).upper(), "date": date, "rawType": raw.get("type") or "", "type": transaction_type(raw.get("type")),
            "quantity": number(raw.get("quantity")), "amount": number(raw.get("transaction_amount_krw")),
            "price": number(raw.get("unit_price_krw")), "commission": number(raw.get("commission_krw")),
            "tax": number(raw.get("tax_krw")), "currency": "USD" if raw.get("unit_price_usd") else "KRW",
            "nativeAmount": number(raw.get("transaction_amount_usd")), "nativePrice": number(raw.get("unit_price_usd")),
            "name": raw.get("stock_name") or None,
        })
    if not items:
        return reject("가져올 수 있는 거래내역이 없습니다.")

    codes = sorted({item["code"] for item in items})
    mappings = {code: (db.collection("stockMappings").document(code).get().to_dict() or {}) for code in codes}
    by_code = defaultdict(list)
    for item in items:
        by_code[item["code"]].append(item)
    portfolio = db.collection("portfolios").document(claims["uid"])
    now = datetime.now(timezone.utc)
    writes = [(portfolio, {"ownerUid": claims["uid"], "ownerEmail": claims.get("email"), "portfolioSources": ["toss-pdf"], "updatedAt": now}, True)]
    current_assets = 0
    for code, asset_transactions in by_code.items():
        mapping = mappings[code]
        asset_id = mapping.get("isin") or code
        latest = sorted(asset_transactions, key=lambda item: item["date"])[-1]
        balance = number(next((raw.get("balance_quantity") for raw in raw_transactions if str(raw.get("ticker", "")).upper() == code and normalized_date(raw.get("date")) == latest["date"]), None))
        status = "current" if balance and balance > 0 else "historical"
        current_assets += status == "current"
        asset = portfolio.collection("assets").document(asset_id)
        writes.append((asset, {"type": "주식", "isin": mapping.get("isin") or code, "symbol": mapping.get("symbol"), "name": mapping.get("koName") or latest["name"], "portfolioPriority": status, "prioritySource": "toss-pdf", "holdingShares": balance or 0, "updatedAt": now}, True))
        for item in asset_transactions:
            transaction = {key: value for key, value in item.items() if key not in {"code", "name"}}
            transaction.update({"source": "toss-pdf", "importedAt": now})
            writes.append((asset.collection("transactions").document(stable_id(item)), transaction, True))
    for offset in range(0, len(writes), 450):
        batch = db.batch()
        for reference, data, merge in writes[offset:offset + 450]:
            batch.set(reference, data, merge=merge)
        batch.commit()
    return jsonify({"transactionCount": len(items), "assetCount": len(by_code), "currentAssetCount": current_assets})
