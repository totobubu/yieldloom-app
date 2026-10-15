"""Reviewed ISIN aliases are server-only; retain the original statement ISIN."""


def security_mapping(db, code):
    reviewed = db.collection("portfolioSecurityMappings").document(code).get()
    if reviewed.exists:
        data = reviewed.to_dict() or {}
        if data.get("symbol"):
            return {**data, "isin": code}
    return db.collection("stockMappings").document(code).get().to_dict() or {}


def candidate_metadata(items):
    """Only public instrument identifiers/names enter the shared queue."""
    import re
    groups = {}
    for item in items:
        code = str(item.get("code") or "").upper()
        if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}\d", code):
            continue
        names = groups.setdefault(code, [])
        name = str(item.get("name") or "").strip()[:200]
        if name and name not in names and len(names) < 10:
            names.append(name)
    return groups


def record_candidates(db, items, mappings, now):
    from firebase_admin import firestore
    from google.api_core.exceptions import AlreadyExists
    for code, names in candidate_metadata(items).items():
        if mappings.get(code, {}).get("symbol"):
            continue
        ref = db.collection("portfolioIsinCandidates").document(code)
        snapshot = ref.get()
        prior = snapshot.to_dict() or {}
        metadata = {"names": list(dict.fromkeys(prior.get("names", []) + names))[:10], "lastSeenAt": now}
        if not snapshot.exists:
            try:
                ref.create({**metadata, "firstSeenAt": now, "status": "pending", "uploadCount": 1})
                continue
            except AlreadyExists:
                pass
        # Never turn a concurrently resolved instrument back into pending.
        ref.set({**metadata, "uploadCount": firestore.Increment(1)}, merge=True)
