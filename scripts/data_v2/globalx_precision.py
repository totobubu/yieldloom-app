"""Keep Global X display observations separate from adopted exact amounts.

A longer decimal string is not proof of correctness. Even a non-rounding change
is retained as a correction proposal, not permanently rejected or auto-adopted.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, localcontext

DISPLAY_NOTE = "globalx_display_precision_unverified"


def amount_evidence(row: dict) -> dict:
    return {key: row.get(key) for key in (
        "amount", "amountPrecision", "officialUrl", "sourceSha256", "verificationStatus",
        "verificationNote", "currency", "recordDate", "payableDate", "frequency",
    )}


def reconcile_observations(previous: dict, rows: list[dict], identity) -> tuple[list[dict], list[dict]]:
    accepted, reviews = [], []
    for row in rows:
        old = previous.get(identity(row))
        if not old:
            # No exact source has been implemented for this display-table parser.
            reviews.append({**row, "verificationStatus": "needs_review",
                            "reviewReason": "exact_amount_unverified"})
            continue
        same_fields = all(old.get(field) == row.get(field) for field in (
            "currency", "recordDate", "payableDate", "frequency",
        ))
        same_amount = Decimal(old["amount"]) == Decimal(row["amount"])
        known_display = row.get("verificationNote") == DISPLAY_NOTE
        same_verification = (known_display or all(old.get(field) == row.get(field)
                             for field in ("verificationStatus", "verificationNote")))
        if same_fields and same_amount and same_verification:
            # Preserve adopted precision, status and its original source hash.
            evidence = list(old.get("amountObservations", []))
            observation = amount_evidence(row)
            if observation not in evidence:
                evidence.append(observation)
            accepted.append({**old, "amountObservations": evidence})
            continue
        reason = "event_fields_changed_requires_review" if not same_fields or not same_verification else "amount_correction_requires_review"
        if same_fields and not same_amount and known_display:
            before, after = Decimal(old["amount"]), Decimal(row["amount"])
            with localcontext() as context:
                context.prec = max(28, len(before.as_tuple().digits), len(after.as_tuple().digits)) + 4
                if (after.as_tuple().exponent > before.as_tuple().exponent
                        and before.quantize(Decimal(1).scaleb(after.as_tuple().exponent), rounding=ROUND_HALF_UP) == after):
                    # A possible explanation, not evidence that no correction occurred.
                    reason = "rounded_display_may_match"
        reviews.append({**row, "verificationStatus": "needs_review", "reviewReason": reason,
                        "retainedEvent": {key: value for key, value in old.items() if key != "amountObservations"}})
    return accepted, reviews
