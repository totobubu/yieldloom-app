"""Privacy-preserving, aggregate-only product funnel collector."""
import os
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore
from flask import Flask, jsonify, request
from api.server_cors import configure_cors
from api.firebase_credential import parse_firebase_credential

app = Flask(__name__)
configure_cors(app)
EVENTS = {"search", "card_open", "png_download", "share_copy"}
CARD_KINDS = {"summary", "comparison", "rival", "calendar", "holding-dividend", "entry-efficiency", "home"}


def database():
    if not firebase_admin._apps:
        raw = os.environ.get("FIRESTORE_SA_KEY")
        if not raw:
            raise RuntimeError("analytics unavailable")
        firebase_admin.initialize_app(credentials.Certificate(parse_firebase_credential(raw)))
    return firestore.client()


@app.post("/api/analytics")
def track():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "invalid aggregate event"}), 400
    event, kind = payload.get("event"), payload.get("cardKind", "home")
    if not isinstance(event, str) or not isinstance(kind, str) or event not in EVENTS or kind not in CARD_KINDS:
        return jsonify({"error": "invalid aggregate event"}), 400
    day = datetime.now(timezone.utc).date().isoformat()
    try:
        database().collection("analyticsDaily").document(day).collection("events").document(f"{event}:{kind}").set({
            "event": event, "cardKind": kind, "count": firestore.Increment(1), "updatedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
    except Exception as error:
        # Keep credentials and SDK exception details out of responses and logs.
        app.logger.warning("Aggregate analytics unavailable (%s)", type(error).__name__)
        return jsonify({"error": "aggregate service unavailable"}), 503
    return ("", 204)
