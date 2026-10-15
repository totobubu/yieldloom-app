"""Authenticated readiness endpoint for a future customer Toss connection."""

import json
import os

import firebase_admin
from firebase_admin import auth, credentials
from flask import Flask, jsonify, request
from api.server_cors import configure_cors

app = Flask(__name__)
configure_cors(app)


def initialise_firebase():
    if firebase_admin._apps:
        return
    raw = os.environ.get("FIRESTORE_SA_KEY")
    if not raw:
        raise RuntimeError("FIRESTORE_SA_KEY is not configured")
    firebase_admin.initialize_app(credentials.Certificate(json.loads(raw)))


def authenticated_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        initialise_firebase()
        return auth.verify_id_token(header[7:])
    except Exception:
        return None


def readiness_payload():
    # Client credentials alone must never be treated as a customer connection.
    server_connection_ready = all(os.environ.get(name) for name in ("TOSS_CLIENT_ID", "TOSS_CLIENT_SECRET", "TOSS_PORTFOLIO_ALLOWED_EMAILS"))
    customer_oauth_ready = server_connection_ready and bool(os.environ.get("TOSS_CUSTOMER_OAUTH_URL"))
    return {
        "provider": "toss",
        "mode": "read_only",
        "status": "customer_oauth_ready" if customer_oauth_ready else "server_connection_ready" if server_connection_ready else "awaiting_customer_oauth",
        "enabled": False,
        "serverConnectionReady": server_connection_ready,
        "customerOauthReady": customer_oauth_ready,
        "message": "고객별 토스 동의 API가 준비되면 읽기 전용 연결을 제공할 예정입니다." if customer_oauth_ready else "현재는 토스 거래내역 PDF 업로드로 개인화할 수 있습니다.",
    }


@app.get("/api/toss-connection")
def toss_connection():
    if not authenticated_user():
        return jsonify({"error": "로그인이 확인되지 않았습니다."}), 401
    return jsonify(readiness_payload())
