"""Privacy-preserving, aggregate-only product funnel collector."""
import json
import os
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore
from flask import Flask, jsonify, request

app = Flask(__name__)
EVENTS = {"search", "card_open", "png_download", "share_copy"}
CARD_KINDS = {"summary", "comparison", "rival", "calendar", "holding-dividend", "entry-efficiency", "home"}


def database():
    if not firebase_admin._apps:
        raw = os.environ.get("FIRESTORE_SA_KEY")
        if not raw:
            raise RuntimeError("analytics unavailable")
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw)))
    return firestore.client()


@app.post("/api/analytics")
def track():
    payload = request.get_json(silent=True) or {}
    event, kind = payload.get("event"), payload.get("cardKind", "home")
    if event not in EVENTS or kind not in CARD_KINDS:
        return jsonify({"error": "invalid aggregate event"}), 400
    day = datetime.now(timezone.utc).date().isoformat()
    database().collection("analyticsDaily").document(day).collection("events").document(f"{event}:{kind}").set({
        "event": event, "cardKind": kind, "count": firestore.Increment(1), "updatedAt": firestore.SERVER_TIMESTAMP,
    }, merge=True)
    return ("", 204)
