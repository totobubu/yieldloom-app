"""Normalize supported credential representations without logging secrets."""
import json


def parse_firebase_credential(value):
    raw = str(value or "").strip()
    candidates = [raw] + (["{" + raw + "}"] if raw.startswith('"type"') else [])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            if isinstance(parsed, dict) and all(isinstance(parsed.get(key), str) and parsed[key] for key in ["project_id", "client_email", "private_key"]):
                return parsed
        except (ValueError, TypeError):
            pass
    raise ValueError("Firebase 관리자 키의 JSON 형식을 확인해 주세요.")
