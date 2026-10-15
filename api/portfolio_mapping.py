"""Reviewed ISIN aliases are server-only; retain the original statement ISIN."""


def security_mapping(db, code):
    reviewed = db.collection("portfolioSecurityMappings").document(code).get()
    if reviewed.exists:
        data = reviewed.to_dict() or {}
        if data.get("symbol"):
            return {**data, "isin": code}
    return db.collection("stockMappings").document(code).get().to_dict() or {}
