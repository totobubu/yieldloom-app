"""Contracts for future licensed/free price adapters; does not alter legacy prices."""
from datetime import date
from decimal import Decimal
import re

BASES = {'unadjusted', 'split_adjusted', 'total_return_adjusted'}


def source_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('Source date is required')
    return date.fromisoformat(value)


def amount(value, positive=True):
    if not isinstance(value, str) or not re.fullmatch(r'\d+(?:\.\d+)?', value):
        raise ValueError('Normalized decimal string is required')
    number = Decimal(value)
    if (positive and number <= 0) or (not positive and number < 0):
        raise ValueError('Invalid market amount')
    return number


def provenance(row):
    if (not row.get('entityId') or not row.get('sourceId')
            or not re.fullmatch('[a-f0-9]{64}', row.get('sourceDocumentId', ''))):
        raise ValueError('Stable identity and archived source are required')


def validate_price(row):
    provenance(row)
    day = source_date(row['asOfDate'])
    if row.get('priceBasis') not in BASES or not re.fullmatch('[A-Z]{3}', row.get('currency', '')):
        raise ValueError('Explicit price basis and currency are required')
    close = amount(row['close'])
    if row.get('coverage') == 'close_only':
        if any(row.get(key) is not None for key in ('open', 'high', 'low')):
            raise ValueError('Close-only data cannot invent OHLC coverage')
    elif row.get('coverage') == 'ohlc':
        opening, high, low = (amount(row[key]) for key in ('open', 'high', 'low'))
        if not low <= min(opening, close) <= max(opening, close) <= high:
            raise ValueError('OHLC bounds conflict')
    else:
        raise ValueError('Explicit price coverage is required')
    if row.get('volume') is not None:
        amount(row['volume'], positive=False)
        if row.get('volumeUnit') != 'shares':
            raise ValueError('Canonical volume requires share units')
    if row['priceBasis'] != 'unadjusted':
        if source_date(row.get('adjustmentAsOfDate')) < day:
            raise ValueError('Adjustment vintage precedes price date')
    return row


def validate_split(row):
    provenance(row)
    source_date(row['effectiveDate'])
    if row.get('actionType') not in ('split', 'reverse_split'):
        raise ValueError('Unsupported action type')
    numerator, denominator = amount(row['newShares']), amount(row['oldShares'])
    if numerator == denominator or (row['actionType'] == 'split') != (numerator > denominator):
        raise ValueError('Split direction/ratio conflict')
    return row
