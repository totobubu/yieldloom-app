"""Read-only row comparison. Variations require review; none are auto-selected."""
from decimal import Decimal, InvalidOperation
import json


def review_rows(rows, *, identity_fields, value_fields, decimal_fields=()):
    """Group explicit identities while retaining every source row and missing value.

    Identity is supplied by the caller: a timestamp alone is not a broker event ID.
    Decimal fields must already be numeric values, not scraped monetary/date text.
    This function establishes neither historical completeness nor approval.
    """
    if not identity_fields or not value_fields:
        raise ValueError('Explicit identity and value fields are required')
    if not set(decimal_fields).issubset(value_fields):
        raise ValueError('Decimal fields must be compared value fields')
    groups = {}
    seen = set()
    duplicates = 0
    for index, row in enumerate(rows):
        if any(row.get(field) is None for field in identity_fields):
            raise ValueError('Missing explicit row identity')
        identity = tuple(row[field] for field in identity_fields)
        encoded = json.dumps(row, sort_keys=True, ensure_ascii=False, default=str)
        if encoded in seen:
            duplicates += 1
        seen.add(encoded)
        group = groups.setdefault(identity, {'rows': [], 'values': {field: {} for field in value_fields}})
        group['rows'].append(index)
        for field in value_fields:
            value = row.get(field)
            comparable = value
            if field in decimal_fields and value is not None:
                if isinstance(value, bool):
                    raise ValueError('Invalid decimal observation')
                try:
                    comparable = Decimal(str(value))
                except InvalidOperation as error:
                    raise ValueError('Invalid decimal observation') from error
                if not comparable.is_finite():
                    raise ValueError('Invalid decimal observation')
            # None is a distinct observation, never an implicit numeric zero.
            group['values'][field].setdefault(comparable, value)
    variations = []
    for identity, group in groups.items():
        fields = {field: list(values.values()) for field, values in group['values'].items()
                  if len(values) > 1}
        if fields:
            variations.append({'identity': dict(zip(identity_fields, identity)),
                               'sourceRowIndexes': group['rows'], 'fields': fields})
    return {'sourceRows': len(rows), 'distinctIdentities': len(groups),
            'exactDuplicateRows': duplicates, 'variations': variations,
            'reviewRequired': bool(variations), 'historicalCompleteness': 'unverified',
            'approved': False, 'writesPerformed': 0}
