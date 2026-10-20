"""Account-scoped portfolio domain. No provider credentials or raw account numbers."""
import csv
import hashlib
import io
import json
import math
import re
from datetime import date

MAX_ROWS = 200
TYPES = {'buy', 'sell', 'dividend', 'dividend_reversal', 'cash_in', 'cash_out', 'transfer_in', 'transfer_out', 'split'}
DETAIL_NUMBERS = {'settlementAmount', 'nativeAmount', 'nativeSettlementAmount', 'exchangeRate', 'nativeCommission', 'nativeTax'}
DETAIL_TEXT = {'rawType', 'cashKind', 'originalCode', 'securityName'}


class PortfolioError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def require(condition, message, status=400):
    if not condition:
        raise PortfolioError(message, status)


def text(value, label, limit=100):
    require(isinstance(value, str) and 0 < len(value.strip()) <= limit, f'{label}: 1~{limit}자를 입력하세요.')
    return value.strip()


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value), '잘못된 식별자입니다.')
    return value


def iso_date(value):
    try:
        return date.fromisoformat(str(value)).isoformat()
    except (ValueError, TypeError):
        raise PortfolioError('기준일/거래일은 YYYY-MM-DD 형식이어야 합니다.')


def numeric(value, required=False, nonnegative=False):
    if value is None or value == '':
        require(not required, '필수 수치가 없습니다.')
        return None
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise PortfolioError('숫자 형식이 올바르지 않습니다.')
    require(math.isfinite(result) and abs(result) <= 1e15 and (not nonnegative or result >= 0), '수치 범위를 확인하세요.')
    return result


def can_access(account, uid, write=False):
    role = account.get('permissions', {}).get(uid)
    return role in ({'owner', 'editor'} if write else {'owner', 'editor', 'viewer'})


def normalize_row(raw, kind):
    row = {'date': iso_date(raw.get('date')), 'symbol': str(raw.get('symbol') or '').strip().upper(),
           'currency': str(raw.get('currency') or '').upper().strip()}
    require(re.fullmatch(r'[A-Z]{3}', row['currency']), '통화는 KRW, USD 등 3자리 코드로 입력하세요.')
    require(re.fullmatch(r'[A-Z0-9.^:_-]{1,40}', row['symbol']), '종목 코드를 입력하세요. 현금은 CASH를 사용하세요.')
    row['quantity'] = numeric(raw.get('quantity'), required=kind == 'holdings', nonnegative=True)
    row['amount'] = numeric(raw.get('amount'), required=False, nonnegative=True)
    if kind == 'transactions':
        row['type'] = str(raw.get('type', ''))
        require(row['type'] in TYPES, '지원하지 않는 거래 유형입니다. 이동·배당·분할 유형을 확인하세요.')
        row['externalId'] = text(raw.get('externalId'), '거래 고유번호', 120)
        require(row['quantity'] is not None or row['amount'] is not None, '수량 또는 금액이 필요합니다.')
        for key in DETAIL_NUMBERS:
            if raw.get(key) not in (None, ''):
                row[key] = numeric(raw[key], nonnegative=True)
        for key in DETAIL_TEXT:
            if raw.get(key) not in (None, ''):
                row[key] = text(raw[key], key, 100)
    return row


def row_key(row):
    # The provider's stable transaction identifier survives corrections and overlapping statements.
    return hashlib.sha256(row['externalId'].encode()).hexdigest()


def calculate_holdings(entries, baseline=None, entries_revision=0, snapshot_revision=0):
    """Materialize share quantities from an immutable transaction ledger."""
    quantities, amounts, issues = {}, {}, []
    baseline_as_of = baseline.get('asOf') if baseline else None
    if baseline:
        for row in baseline.get('rows', []):
            quantities[(row['symbol'], row['currency'])] = float(row['quantity'])
            amounts[(row['symbol'], row['currency'])] = row.get('amount')
    latest = baseline_as_of
    for entry in sorted(entries, key=lambda item: (item.get('row', {}).get('date', ''), item.get('id', ''))):
        if entry.get('voidedAt'):
            continue
        row = entry.get('row', entry)
        day, kind = row.get('date'), row.get('type')
        if baseline_as_of and day <= baseline_as_of:
            continue
        latest = max(latest or day, day)
        if kind in {'dividend', 'dividend_reversal', 'cash_in', 'cash_out'}:
            continue
        key = (row.get('symbol'), row.get('currency'))
        quantity = row.get('quantity')
        if kind == 'split' or quantity is None:
            issues.append({'symbol': key[0], 'currency': key[1], 'reason': 'split' if kind == 'split' else 'missing_quantity'})
            continue
        delta = float(quantity) * (-1 if kind in {'sell', 'transfer_out'} else 1)
        quantities[key] = quantities.get(key, 0) + delta
        amounts[key] = None
        if quantities[key] < -1e-9:
            issues.append({'symbol': key[0], 'currency': key[1], 'reason': 'negative_quantity'})
    issue_keys = {(item['symbol'], item['currency']) for item in issues}
    rows = [{'symbol': symbol, 'currency': currency, 'quantity': quantity, 'amount': amounts.get((symbol, currency)),
             'status': 'needs_review' if (symbol, currency) in issue_keys else 'ready'}
            for (symbol, currency), quantity in sorted(quantities.items()) if abs(quantity) > 1e-9]
    return {'rows': rows, 'asOf': latest, 'baselineAsOf': baseline_as_of,
            'mode': 'anchored' if baseline else 'estimated',
            'status': 'needs_review' if issues else 'ready', 'issues': issues,
            'entriesRevision': entries_revision, 'snapshotRevision': snapshot_revision}


def apply_holding_entries(calculated, entries, entries_revision):
    """Increment an already-current materialization without reading the ledger."""
    baseline = {'asOf': calculated.get('baselineAsOf'), 'rows': calculated.get('rows', [])}
    result = calculate_holdings(entries, baseline, entries_revision, calculated.get('snapshotRevision', 0))
    result['mode'] = calculated.get('mode', result['mode'])
    result['baselineAsOf'] = calculated.get('baselineAsOf')
    result['issues'] = list(calculated.get('issues', [])) + result['issues']
    result['status'] = 'needs_review' if result['issues'] else 'ready'
    result['asOf'] = max(filter(None, [calculated.get('asOf'), result.get('asOf')]), default=None)
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def parse_csv(content):
    try:
        decoded = content.decode('utf-8-sig')
        reader = csv.DictReader(io.StringIO(decoded), strict=True)
        require(reader.fieldnames and {'date', 'symbol', 'quantity', 'amount', 'currency'} <= set(reader.fieldnames), '표준 CSV 헤더가 필요합니다: date,symbol,quantity,amount,currency (거래: type,externalId 추가)')
        require(len(set(reader.fieldnames)) == len(reader.fieldnames) and len(reader.fieldnames) <= 20, 'CSV 헤더가 중복되었거나 열이 너무 많습니다.')
        rows = list(reader)
        require(0 < len(rows) <= MAX_ROWS, f'파일당 1~{MAX_ROWS}행을 지원합니다. 기간을 나누어 주세요.')
        require(all(None not in row and all(v is not None for v in row.values()) for row in rows), 'CSV 열 개수가 맞지 않습니다.')
        for row in rows:
            marker = row.get('csvEscaped', '')
            if not marker:
                continue
            require(marker.startswith('v1:'), 'CSV 안전 처리 표시의 버전을 확인하세요.')
            fields = marker[3:].split('|')
            require(len(fields) == len(set(fields)) and all(key in row and key != 'csvEscaped' for key in fields), 'CSV 안전 처리 표시의 열을 확인하세요.')
            for key in fields:
                require(row[key].startswith("'"), 'CSV 안전 처리 표시와 셀 값이 일치하지 않습니다.')
                # Only the explicitly marked protective quote is removed. A
                # genuine leading apostrophe remains part of the original id.
                row[key] = row[key][1:]
        return rows
    except (UnicodeError, csv.Error):
        raise PortfolioError('UTF-8 표준 CSV를 확인하세요.')


def validate_rows(rows, kind, as_of, max_rows=MAX_ROWS):
    require(kind in {'transactions', 'holdings'}, '자료 종류를 선택하세요.')
    require(isinstance(rows, list) and 0 < len(rows) <= max_rows, '행 개수를 확인하세요.')
    normalized, errors = [], []
    for index, raw in enumerate(rows):
        try:
            require(isinstance(raw, dict), '행 형식이 잘못되었습니다.')
            row = normalize_row(raw, kind)
            require(row['date'] <= as_of, '자료 기준일 이후의 행입니다.')
            if kind == 'holdings':
                require(row['date'] == as_of, '잔고 행의 날짜는 자료 기준일과 같아야 합니다.')
            normalized.append(row)
        except PortfolioError as error:
            errors.append({'row': index + 1, 'error': str(error)})
    if not errors:
        keys = [row_key(row) if kind == 'transactions' else row['symbol'] + ':' + row['currency'] for row in normalized]
        if len(set(keys)) != len(keys):
            errors.append({'row': 0, 'error': '파일 안의 거래 고유번호 또는 잔고 종목·통화가 중복됩니다.'})
    return normalized, errors


def summarize(accounts):
    """No inferred holdings, FX conversion, transfer P&L, or mixed-date certainty."""
    positions, totals, dates, missing = [], {}, [], []
    for account in accounts:
        snapshot = account.get('calculatedSnapshot')
        current = (snapshot and snapshot.get('entriesRevision') == account.get('entriesRevision', 0)
                   and snapshot.get('snapshotRevision') == account.get('snapshotRevision', 0))
        if not current:
            snapshot = None
        if not snapshot:
            missing.append(account['id'])
            continue
        dates.append(snapshot['asOf'])
        for row in snapshot['rows']:
            positions.append({**row, 'accountId': account['id'], 'ownerId': account['ownerId'], 'asOf': snapshot['asOf'],
                              'source': 'calculated', 'calculationMode': snapshot['mode'], 'calculationStatus': snapshot['status']})
            if row['amount'] is not None:
                totals[row['currency']] = totals.get(row['currency'], 0) + row['amount']
    return {'positions': positions, 'knownValueByCurrency': totals, 'missingSnapshotAccounts': missing,
            'mixedDates': len(set(dates)) > 1, 'oldestAsOf': min(dates) if dates else None,
            'newestAsOf': max(dates) if dates else None,
            'valueComplete': not missing and all(row['amount'] is not None for row in positions),
            'notice': '접근 가능한 계좌의 잔고 자료 합계입니다. 현재 평가액·수익률이 아니며 통화별로 구분합니다.'}
