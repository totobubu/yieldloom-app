"""Authenticated family portfolio API. All new stores are server-only in rules."""
import hashlib
import json
import os
import re
import secrets
import tempfile
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import firebase_admin
from google.api_core.exceptions import ResourceExhausted
from firebase_admin import auth, credentials, firestore
from flask import Flask, g, has_request_context, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from api.family_portfolio_service import (DETAIL_NUMBERS, DETAIL_TEXT, PortfolioError, apply_holding_entries,
                                      calculate_holdings, can_access, digest, identifier, iso_date,
                                      normalize_row, parse_csv, require, row_key, summarize, text, validate_rows)
from api.server_cors import configure_cors
from api.firebase_credential import parse_firebase_credential
from api.portfolio_pdf_secret import seal_password, open_password
from api.portfolio_spreadsheet import inspect_spreadsheet, mapped_spreadsheet, standard_xlsx
from api.portfolio_statements import monthly_reports, change_monthly_report, alert_preferences, save_alert_preferences

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 3 * 1024 * 1024
configure_cors(app)


@app.after_request
def private_response(response):
    response.headers['Cache-Control'] = 'private, no-store'
    if request.method != 'OPTIONS':
        response.headers['X-Portfolio-Document-Reads'] = str(getattr(g, 'portfolio_document_reads', 0))
        response.headers['X-Portfolio-Read-Operations'] = str(getattr(g, 'portfolio_read_operations', 0))
    return response


def database():
    if not firebase_admin._apps:
        raw = os.environ.get('FIRESTORE_SA_KEY')
        if not raw:
            raise PortfolioError('저장 서비스가 설정되지 않았습니다.', 503)
        firebase_admin.initialize_app(credentials.Certificate(parse_firebase_credential(raw)))
    return firestore.client()


def now():
    return datetime.now(timezone.utc)


def read_snapshot(ref, transaction=None):
    if has_request_context():
        g.portfolio_read_operations = getattr(g, 'portfolio_read_operations', 0) + 1
    snap = ref.get(transaction=transaction) if transaction else ref.get()
    if has_request_context():
        g.portfolio_document_reads = getattr(g, 'portfolio_document_reads', 0) + 1
    return snap


def read_results(snapshots):
    if has_request_context():
        g.portfolio_read_operations = getattr(g, 'portfolio_read_operations', 0) + 1
    for snap in snapshots:
        if has_request_context():
            g.portfolio_document_reads = getattr(g, 'portfolio_document_reads', 0) + 1
        yield snap


def read_stream(query):
    return read_results(query.stream())


def load(ref, transaction=None):
    snap = read_snapshot(ref, transaction)
    require(snap.exists, '자료가 없거나 접근할 수 없습니다.', 404)
    return snap.to_dict()


def family(db, family_id, uid):
    ref = db.collection('familySpaces').document(identifier(family_id))
    data = load(ref)
    require(uid in data['participantUids'], '가족 공간 접근 권한이 없습니다.', 403)
    return ref, data


def account(db, account_id, uid, write=False):
    ref = db.collection('investmentAccounts').document(identifier(account_id))
    data = load(ref)
    require(can_access(data, uid, write), '계좌 접근 권한이 없습니다.', 403)
    family(db, data['familyId'], uid)
    return ref, data


def pdf_rows(content, password, *, metadata=None):
    from api.toss_extractor import extract_transactions_from_pdf
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as handle:
            handle.write(content)
            path = handle.name
        result = extract_transactions_from_pdf(path, verbose=False, password=password)
    except Exception:
        raise PortfolioError('PDF를 해석하지 못했습니다. 지원 형식과 비밀번호를 확인하세요.')
    finally:
        if path:
            os.remove(path)
    if metadata is not None:
        extracted = result.get('metadata') or {}
        number = re.sub(r'[^0-9*•●]', '', str(extracted.get('account_number') or ''))
        metadata.update({
            'customerName': str(extracted.get('customer_name') or '')[:100],
            'maskedNumber': '****' + number[-4:] if len(number) >= 8 and number[-4:].isdigit() else None,
        })
    rows = []
    occurrences = {}
    for raw in result.get('transactions', []):
        if not raw.get('ticker'):
            continue
        raw_type = str(raw.get('type', ''))
        kind = 'dividend_reversal' if '배당' in raw_type and '취소' in raw_type else 'dividend' if '배당' in raw_type else 'buy' if '매수' in raw_type or '구매' in raw_type else 'sell' if '매도' in raw_type or '판매' in raw_type else 'unknown'
        if kind == 'unknown':
            kind = ('transfer_in' if '입고' in raw_type else 'transfer_out' if '출고' in raw_type
                    else 'cash_in' if '세금환급' in raw_type else 'cash_out' if '세액출금' in raw_type else 'unknown')
        day = str(raw.get('date', '')).replace('.', '-').strip()
        native_amount = raw.get('transaction_amount_usd')
        foreign = native_amount is not None or str(raw.get('ticker', '')).startswith('US')
        row = {'date': day, 'symbol': raw.get('ticker', ''), 'type': kind,
               'quantity': raw.get('quantity'),
               'amount': native_amount if foreign and native_amount is not None else raw.get('transaction_amount_krw'),
               'currency': 'USD' if foreign else 'KRW'}
        key = digest(row)
        occurrences[key] = occurrences.get(key, 0) + 1
        row['externalId'] = f'toss-pdf:{key}:{occurrences[key]}'
        row.update({key: raw.get(source) for key, source in {
            'rawType':'type', 'convertedAmount':'transaction_amount_krw',
            'settlementAmount':'settlement_amount_krw', 'nativeAmount':'transaction_amount_usd',
            'nativeSettlementAmount':'settlement_amount_usd', 'exchangeRate':'exchange_rate',
            'nativeCommission':'commission_usd', 'nativeTax':'tax_usd',
        }.items() if raw.get(source) is not None})
        row['originalCode'] = raw['ticker']
        row['securityName'] = raw.get('stock_name') or raw['ticker']
        rows.append(row)
    for raw in result.get('cash_transactions', []):
        row = {'date':raw['date'].replace('.','-'), 'symbol':'CASH', 'quantity':None, 'amount':raw['amount'], 'currency':raw['currency'],
               'type':'cash_out' if raw.get('direction', 'out' if '출금' in raw['rawType'] else 'in') == 'out' else 'cash_in', 'rawType':raw['rawType'], 'cashKind':raw['suggestedKind']}
        if raw.get('exchangeRate'):
            row['exchangeRate'] = raw['exchangeRate']
        identity = digest({**row,'balance':raw.get('balance')})
        occurrences[identity] = occurrences.get(identity,0) + 1
        row['externalId'] = f'toss-cash:{identity}:{occurrences[identity]}'
        rows.append(row)
    for rejected in result.get('rejected_rows', []):
        rows.append({'date': rejected.get('date', '').replace('.', '-'), 'symbol': '', 'quantity': None, 'amount': None, 'currency': 'KRW', 'type': 'unknown', 'externalId': f"unparsed-page-{rejected['page']}-line-{rejected['line']}"})
    require(rows, '추출된 거래가 없습니다. 표준 CSV를 사용하세요.')
    return rows


def create_family(db, uid, body):
    ref = db.collection('familySpaces').document()
    profile = uuid4().hex
    data = {'schemaVersion': 2, 'name': text(body.get('name'), '가족 이름'), 'adminUid': uid,
            'participantUids': [uid], 'profiles': {profile: {'name': text(body.get('profileName'), '내 이름'), 'kind': 'adult', 'uid': uid}}, 'createdAt': now()}
    ref.set(data)
    return {'familyId': ref.id}


def ensure_personal_space(db, uid, body):
    """Create the user's private account container once, only on explicit account registration."""
    ref = db.collection('familySpaces').document('personal_' + hashlib.sha256(uid.encode()).hexdigest()[:32])
    profile_id = 'self_' + hashlib.sha256(uid.encode()).hexdigest()[:24]
    @firestore.transactional
    def apply(tx):
        existing = read_snapshot(ref, tx)
        if existing.exists:
            require(uid in existing.to_dict()['participantUids'], '공간 접근 권한이 없습니다.', 403)
        else:
            tx.set(ref, {'schemaVersion': 2, 'kind': 'personal', 'name': '내 포트폴리오',
                         'adminUid': uid, 'participantUids': [uid], 'createdAt': now(),
                         'profiles': {profile_id: {'name': text(body.get('profileName') or '본인', '내 이름'),
                                               'kind': 'adult', 'uid': uid}}})
        return {'familyId': ref.id}
    return apply(db.transaction())


def mutate_family(db, uid, action, body):
    ref, _ = family(db, body.get('familyId'), uid)
    @firestore.transactional
    def apply(tx):
        data = load(ref, tx)
        require(uid in data['participantUids'], '가족 공간 접근 권한이 없습니다.', 403)
        if action == 'renameFamily':
            require(data['adminUid'] == uid, '가족 관리자만 변경할 수 있습니다.', 403)
            data['name'] = text(body.get('name'), '가족 이름')
        elif action == 'renameProfile':
            profile = data['profiles'].get(identifier(body.get('profileId')))
            require(profile and (profile.get('uid') == uid or profile.get('guardianUid') == uid), '프로필 변경 권한이 없습니다.', 403)
            profile['name'] = text(body.get('name'), '이름')
        elif action == 'addMinor':
            require(body.get('guardianAttestation') is True, '법정 보호자임을 확인하세요.')
            data['profiles'][uuid4().hex] = {'name': text(body.get('name'), '자녀 이름'), 'kind': 'minor', 'guardianUid': uid, 'guardianAttestedAt': now().isoformat()}
        elif action == 'invite':
            require(data['adminUid'] == uid, '가족 관리자만 초대할 수 있습니다.', 403)
            token = secrets.token_urlsafe(32)
            tx.set(db.collection('familyInvitations').document(hashlib.sha256(token.encode()).hexdigest()), {'familyId': ref.id, 'expiresAt': now() + timedelta(days=2)})
            return {'invitation': token, 'expiresInHours': 48}
        require(len(data['profiles']) <= 30, '가족 프로필은 최대 30명입니다.')
        tx.set(ref, data)
        return {'ok': True}
    return apply(db.transaction())


def join_family(db, uid, body):
    token = text(body.get('invitation'), '초대 코드', 100)
    invite = db.collection('familyInvitations').document(hashlib.sha256(token.encode()).hexdigest())
    @firestore.transactional
    def apply(tx):
        entry = load(invite, tx)
        require(entry['expiresAt'] > now(), '초대가 만료되었습니다.', 410)
        ref = db.collection('familySpaces').document(entry['familyId'])
        data = load(ref, tx)
        require(uid not in data['participantUids'], '이미 참여한 가족입니다.')
        require(len(data['profiles']) < 30, '가족 프로필은 최대 30명입니다.')
        data['participantUids'].append(uid)
        data['profiles'][uuid4().hex] = {'name': text(body.get('name'), '내 이름'), 'kind': 'adult', 'uid': uid}
        tx.set(ref, data)
        tx.delete(invite)
        return {'familyId': ref.id}
    return apply(db.transaction())


def create_account(db, uid, body):
    _, space = family(db, body.get('familyId'), uid)
    owner_id = identifier(body.get('ownerId'))
    owner = space['profiles'].get(owner_id)
    require(owner and (owner.get('uid') == uid or owner.get('guardianUid') == uid), '본인 또는 보호 중인 자녀의 계좌만 등록할 수 있습니다.', 403)
    require(body.get('type') in {'general', 'isa', 'pension', 'other'}, '계좌 유형을 선택하세요.')
    last4 = str(body.get('last4', ''))
    require(not last4 or re_last4(last4), '계좌번호는 끝 4자리만 입력하세요.')
    ref = db.collection('investmentAccounts').document()
    ref.set({'schemaVersion': 2, 'familyId': body['familyId'], 'ownerId': owner_id,
             'authorityUid': uid, 'permissions': {uid: 'owner'}, 'institution': text(body.get('institution'), '금융기관'),
             'type': body['type'], 'alias': text(body.get('alias'), '계좌 별칭'), 'maskedNumber': f'****{last4}' if last4 else '미입력',
             'source': 'manual', 'asOf': None, 'createdAt': now(), 'connection': {'mode': 'file', 'provider': None}})
    return {'accountId': ref.id}


def re_last4(value):
    return len(value) == 4 and value.isascii() and value.isdigit()


def edit_account(db, uid, body, permission=False):
    ref, _ = account(db, body.get('accountId'), uid, True)
    @firestore.transactional
    def apply(tx):
        data = load(ref, tx)
        require(data['authorityUid'] == uid, '명의자 또는 보호자만 계좌 설정을 변경할 수 있습니다.', 403)
        if permission:
            # Reading membership in the same transaction prevents grants to outsiders.
            space = load(db.collection('familySpaces').document(data['familyId']), tx)
            target = identifier(body.get('uid'))
            require(target in space['participantUids'] and target != uid, '참여한 다른 성인을 선택하세요.')
            role = body.get('role')
            require(role in {'viewer', 'editor', 'none'}, '권한을 확인하세요.')
            if role == 'none':
                data['permissions'].pop(target, None)
            else:
                data['permissions'][target] = role
        else:
            data['alias'] = text(body.get('alias'), '계좌 별칭')
        tx.set(ref, data)
        return {'ok': True}
    return apply(db.transaction())


def spreadsheet_inspection(db, uid):
    _, data = account(db, request.form.get('accountId'), uid, True)
    require(request.form.get('ownerId') == data['ownerId'] and request.form.get('institution') == data['institution'], '명의자·금융기관 선택이 계좌와 일치하지 않습니다.')
    require(request.form.get('identityConfirmed') == 'true', '선택한 계좌의 자료임을 확인하세요.')
    uploaded = request.files.get('file')
    require(uploaded is not None, '파일을 선택하세요.')
    content = uploaded.read(2 * 1024 * 1024 + 1)
    require(0 < len(content) <= 2 * 1024 * 1024, '파일은 2MB 이하여야 합니다.', 413)
    return inspect_spreadsheet(content, uploaded.filename or '', request.form)


def preview(db, uid):
    ref, data = account(db, request.form.get('accountId'), uid, True)
    require(request.form.get('ownerId') == data['ownerId'] and request.form.get('institution') == data['institution'], '명의자·금융기관 선택이 계좌와 일치하지 않습니다.')
    statement_identity = None
    password_saved = False
    kind = request.form.get('kind')
    as_of = None
    uploaded = request.files.get('file')
    require(uploaded is not None, '파일을 선택하세요.')
    content = uploaded.read(2 * 1024 * 1024 + 1)
    require(0 < len(content) <= 2 * 1024 * 1024, '파일은 2MB 이하여야 합니다.', 413)
    filename = str(uploaded.filename or '').lower()
    is_pdf = filename.endswith('.pdf') and request.form.get('format') == 'toss-pdf'
    if not is_pdf:
        require(request.form.get('identityConfirmed') == 'true', '자료의 명의자와 계좌를 직접 확인하세요. 불확실한 자료는 저장할 수 없습니다.')
    if request.form.get('format') == 'broker-spreadsheet':
        as_of = iso_date(request.form.get('asOf'))
        rows, source = mapped_spreadsheet(content, filename, request.form, kind, as_of)
    elif filename.endswith('.xlsx') and request.form.get('format') == 'standard-xlsx':
        as_of = iso_date(request.form.get('asOf'))
        rows = standard_xlsx(content, filename)
        source = 'standard-xlsx-v1'
    elif filename.endswith('.csv'):
        as_of = iso_date(request.form.get('asOf'))
        rows = parse_csv(content)
        source = 'standard-csv-v1'
    else:
        require(filename.endswith('.pdf') and content.startswith(b'%PDF-') and kind == 'transactions' and request.form.get('format') == 'toss-pdf', '표준 CSV 또는 토스 거래내역 PDF만 지원합니다.')
        password = request.form.get('password', '')
        if not password:
            saved = read_snapshot(ref.collection('secrets').document('tossPdfPassword'))
            if saved.exists:
                try:
                    password = open_password(saved.to_dict()['envelope'], 'toss:' + ref.id)
                except Exception:
                    raise PortfolioError('저장된 PDF 비밀번호를 사용할 수 없습니다. 비밀번호를 다시 입력해 저장하세요.')
        require(password, '토스 PDF 비밀번호를 입력하거나 계좌 기본값을 저장하세요.')
        statement_identity = {}
        rows = pdf_rows(content, password, metadata=statement_identity)
        extracted_number = statement_identity.get('maskedNumber')
        registered_number = data.get('maskedNumber') or ''
        statement_identity['accountMatch'] = (
            'missing' if not extracted_number else
            'unregistered' if not re.fullmatch(r'\*{4}\d{4}', registered_number) else
            'matched' if extracted_number == registered_number else 'mismatch'
        )
        valid_dates = []
        for row in rows:
            try:
                valid_dates.append(iso_date(row.get('date')))
            except PortfolioError:
                pass
        require(valid_dates, 'PDF에서 거래일을 확인할 수 없습니다.')
        as_of = max(valid_dates)
        if request.form.get('rememberPassword') == 'true' and statement_identity['accountMatch'] == 'matched':
            save_pdf_password(db, uid, {'accountId': ref.id, 'password': password})
            password_saved = True
        source = 'toss-pdf'
        mapping_cache = {}
        for row in rows:
            code = row.get('symbol')
            if code and code != 'CASH':
                if code not in mapping_cache:
                    mapping = read_snapshot(db.collection('stockMappings').document(identifier(code)))
                    mapping_cache[code] = mapping.to_dict().get('symbol') if mapping.exists else None
                if mapping_cache[code]:
                    row['symbol'] = mapping_cache[code]
    limit = 10000 if source == 'toss-pdf' else 200
    require(len(rows) <= limit and len(json.dumps(rows)) < 4000000, '자료가 너무 큽니다. 조회 기간을 나누어 주세요.')
    _, errors = validate_rows(rows, kind, as_of, max_rows=limit)
    # Review sessions contain only normalized rows; secrets live separately.
    columns = {'date', 'symbol', 'quantity', 'amount', 'currency', 'type', 'externalId'} | DETAIL_NUMBERS | DETAIL_TEXT
    rows = [{key: value for key, value in row.items() if key in columns} for row in rows]
    file_hash = hashlib.sha256(content).hexdigest()
    if source == 'standard-xlsx-v1' or source.startswith('broker-mapped-v1:'):
        file_hash = digest([file_hash, source, kind, as_of, request.form.get('sheet', ''),
                            request.form.get('headerRow', '1'), request.form.get('encoding', 'utf-8-sig'),
                            request.form.get('mapping', ''), request.form.get('defaultCurrency', '')])
    batches = []
    for start in range(0, len(rows), 200):
        session = ref.collection('reviews').document()
        receipt_key = file_hash if len(rows) <= 200 else f'{file_hash}-{start // 200}'
        session.set({'uid': uid, 'rows': rows[start:start + 200], 'kind': kind, 'asOf': as_of, 'source': source,
                     'statementIdentity': statement_identity,
                     'fileHash': receipt_key, 'expiresAt': now() + timedelta(hours=1)})
        batches.append({'reviewId': session.id, 'start': start, 'count': min(200, len(rows) - start)})
    return {'reviewId': batches[0]['reviewId'], 'batches': batches, 'rows': rows, 'errors': errors, 'source': source,
            'asOf': as_of, 'statementIdentity': statement_identity, 'passwordSaved': password_saved}


def require_statement_identity(review, data, body):
    if review['source'] != 'toss-pdf':
        return
    identity = review.get('statementIdentity') or {}
    number = identity.get('maskedNumber')
    require(number and re.fullmatch(r'\*{4}\d{4}', number),
            'PDF에서 계좌번호를 확인할 수 없습니다. 원본 파일과 지원 형식을 확인해 다시 추출하세요.')
    registered = data.get('maskedNumber') or ''
    require(not re.fullmatch(r'\*{4}\d{4}', registered) or registered == number,
            'PDF의 계좌번호가 선택한 계좌와 다릅니다. 올바른 계좌를 선택해 다시 추출하세요.')
    require(body.get('identityConfirmed') is True,
            'PDF에서 추출한 명의자·계좌번호와 저장 대상 계좌를 확인하세요.')


def preview_manual_holdings(db, uid, body):
    ref, data = account(db, body.get('accountId'), uid, True)
    require(body.get('identityConfirmed') is True and body.get('completeSnapshotConfirmed') is True,
            '선택 계좌의 전체 잔고임을 확인하세요.')
    old = data.get('snapshot')
    expected = {'asOf': old.get('asOf'), 'importedAt': old.get('importedAt')} if old else None
    require(body.get('baseSnapshot') == expected, '잔고가 변경되었습니다. 계좌를 새로고침하고 다시 입력하세요.', 409)
    as_of = iso_date(body.get('asOf'))
    correction = body.get('correction') is True
    reason = text(body.get('correctionReason'), '정정 사유', 200) if correction else None
    if correction:
        require(old and as_of == old['asOf'], '정정은 현재 잔고와 같은 기준일만 가능합니다.', 409)
    else:
        require(not old or as_of > old['asOf'], '기존 잔고보다 새로운 기준일을 입력하세요.', 409)
    rows, errors = validate_rows(body.get('rows'), 'holdings', as_of)
    require(not errors, '입력 내용을 확인하세요: ' + json.dumps(errors, ensure_ascii=False))
    require(not correction or rows != old['rows'], '변경된 잔고가 없습니다.')
    base_hash = digest(old)
    session = ref.collection('reviews').document()
    session.set({'uid': uid, 'rows': rows, 'kind': 'holdings', 'asOf': as_of,
                 'source': 'manual-holdings-v1', 'baseSnapshotHash': base_hash,
                 'correction': correction, 'correctionReason': reason,
                 'fileHash': digest(['manual-holdings-v1', as_of, rows, base_hash, correction, reason]),
                 'expiresAt': now() + timedelta(hours=1)})
    return {'reviewId': session.id, 'rows': rows, 'errors': [], 'source': 'manual-holdings-v1',
            'correction': correction, 'correctionReason': reason}


def save_pdf_password(db, uid, body):
    ref, data = account(db, body.get('accountId'), uid, True)
    require(data.get('permissions', {}).get(uid) == 'owner', '계좌 소유자만 PDF 기본 비밀번호를 변경할 수 있습니다.', 403)
    remove = body.get('remove') is True
    try:
        envelope = None if remove else seal_password(body.get('password'), 'toss:' + ref.id)
    except ValueError:
        raise PortfolioError('토스 PDF 비밀번호는 생년월일 6자리로 입력하세요.')
    @firestore.transactional
    def apply(tx):
        current = load(ref, tx)
        require(current.get('permissions', {}).get(uid) == 'owner', '계좌 소유 권한이 변경되었습니다.', 403)
        secret = ref.collection('secrets').document('tossPdfPassword')
        if remove:
            tx.delete(secret)
        else:
            tx.set(secret, {'envelope': envelope, 'updatedAt': now(), 'updatedBy': uid})
        current['pdfPasswordConfigured'] = not remove
        tx.set(ref, current)
        return {'configured': not remove}
    return apply(db.transaction())


def rebuild_calculated_snapshot(db, uid, account_id, retries=2):
    """Read a ledger once, then publish only if its revisions are unchanged."""
    ref, data = account(db, account_id, uid, True)
    for _ in range(retries):
        expected_entries = data.get('entriesRevision', 0)
        expected_snapshot = data.get('snapshotRevision', 0)
        entries = [{'id': snap.id, **snap.to_dict()} for snap in read_stream(ref.collection('entries').order_by('__name__').limit(10001))]
        require(len(entries) <= 10000, '거래 원장이 너무 커 별도 재계산이 필요합니다.', 409)
        calculated = calculate_holdings(entries, data.get('snapshot'), expected_entries, expected_snapshot)
        calculated['calculatedAt'] = now().isoformat()
        @firestore.transactional
        def publish(tx):
            current = load(ref, tx)
            require(can_access(current, uid, True), '계좌 변경 권한이 없습니다.', 403)
            if (current.get('entriesRevision', 0), current.get('snapshotRevision', 0)) != (expected_entries, expected_snapshot):
                return False
            current['calculatedSnapshot'] = calculated
            current['calculationStatus'] = calculated['status']
            tx.set(ref, current)
            return True
        if publish(db.transaction()):
            return {'calculatedSnapshot': calculated}
        data = load(ref)
    raise PortfolioError('계산 중 거래내역이 변경되었습니다. 다시 시도하세요.', 409)


def mutate_entry(db, uid, body):
    ref, _ = account(db, body.get('accountId'), uid, True)
    request_id = identifier(body.get('requestId'))
    operation = body.get('operation')
    require(operation in {'add', 'void', 'replace', 'restore'}, '지원하지 않는 원장 변경입니다.')
    reason = text(body.get('reason'), '변경 사유', 200)
    target_id = identifier(body.get('entryId')) if operation != 'add' else None
    replacement = None
    if operation in {'add', 'replace'}:
        replacement = normalize_row(body.get('row') or {}, 'transactions')
    audit = ref.collection('entryCorrections').document(request_id)
    @firestore.transactional
    def apply(tx):
        data = load(ref, tx)
        require(can_access(data, uid, True), '계좌 변경 권한이 없습니다.', 403)
        prior = read_snapshot(audit, tx)
        payload_hash = digest({'operation': operation, 'entryId': target_id, 'reason': reason, 'row': replacement})
        if prior.exists:
            require(prior.to_dict()['payloadHash'] == payload_hash, '같은 요청 번호의 내용이 다릅니다.', 409)
            return {'alreadyApplied': True}
        target = ref.collection('entries').document(target_id) if target_id else None
        old = read_snapshot(target, tx) if target else None
        if operation != 'add':
            require(old.exists, '대상 거래가 없습니다.', 404)
        old_data = old.to_dict() if old else None
        if operation in {'void', 'replace'}:
            require(not old_data.get('voidedAt'), '이미 취소된 거래입니다.', 409)
        if operation == 'restore':
            require(old_data.get('voidedAt'), '취소되지 않은 거래입니다.', 409)
        new_ref = ref.collection('entries').document(row_key(replacement)) if replacement else None
        if new_ref:
            existing = read_snapshot(new_ref, tx)
            require(not existing.exists, '같은 거래 고유번호가 이미 있습니다.', 409)
        revision = data.get('entriesRevision', 0) + 1
        timestamp = now().isoformat()
        if operation in {'void', 'replace'}:
            tx.set(target, {**old_data, 'voidedAt': timestamp, 'voidedBy': uid, 'voidReason': reason})
        elif operation == 'restore':
            restored = {key: value for key, value in old_data.items() if key not in {'voidedAt', 'voidedBy', 'voidReason'}}
            tx.set(target, restored)
        if new_ref:
            tx.set(new_ref, {'row': replacement, 'source': 'manual-correction-v1', 'asOf': replacement['date'],
                             'importedAt': timestamp, 'replacesEntryId': target_id})
        data.update({'entriesRevision': revision, 'calculationStatus': 'stale'})
        tx.set(ref, data)
        tx.set(audit, {'payloadHash': payload_hash, 'operation': operation, 'entryId': target_id,
                       'replacementEntryId': new_ref.id if new_ref else None, 'reason': reason,
                       'changedBy': uid, 'changedAt': timestamp, 'entriesRevision': revision})
        return {'alreadyApplied': False}
    result = apply(db.transaction())
    if not result.get('alreadyApplied'):
        result.update(rebuild_calculated_snapshot(db, uid, ref.id))
    return result


def commit(db, uid, body):
    ref, _ = account(db, body.get('accountId'), uid, True)
    session = ref.collection('reviews').document(identifier(body.get('reviewId')))
    @firestore.transactional
    def apply(tx):
        data = load(ref, tx)
        require(can_access(data, uid, True), '계좌 변경 권한이 없습니다.', 403)
        review = load(session, tx)
        require(review['uid'] == uid and review['expiresAt'] > now(), '검토 세션이 만료되었거나 권한이 없습니다.', 410)
        require_statement_identity(review, data, body)
        submitted = body.get('rows')
        if review['kind'] == 'transactions':
            require(isinstance(submitted, list) and len(submitted) == len(review['rows']) and
                    all(isinstance(row, dict) and row.get('externalId') == original.get('externalId')
                        for row, original in zip(submitted, review['rows'])),
                    '거래 내부 식별자는 변경할 수 없습니다.', 409)
        rows, errors = validate_rows(submitted, review['kind'], review['asOf'])
        require(not errors, '오류 행을 모두 수정하세요: ' + json.dumps(errors, ensure_ascii=False))
        receipt = ref.collection('imports').document(review['fileHash'])
        previous = read_snapshot(receipt, tx)
        if previous.exists:
            return {'inserted': 0, 'duplicates': len(rows), 'alreadyImported': True}
        if review['source'] == 'manual-holdings-v1':
            require(digest(data.get('snapshot')) == review['baseSnapshotHash'],
                    '검토 중 잔고가 변경되었습니다. 계좌를 새로고침하고 다시 입력하세요.', 409)
        if review['kind'] == 'transactions':
            refs = [ref.collection('entries').document(row_key(row)) for row in rows]
            if hasattr(db, 'get_all'):
                snapshots = {item.reference.path: item for item in read_results(db.get_all(refs, transaction=tx))}
                existing = [snapshots[item.path] for item in refs]
            else:
                existing = [read_snapshot(item, tx) for item in refs]
            for row, old in zip(rows, existing):
                require(not old.exists or old.to_dict()['row'] == row, '같은 거래 고유번호의 내용이 다릅니다. 원장을 확인하세요.', 409)
            inserted = sum(not old.exists for old in existing)
            if inserted:
                previous_revision = data.get('entriesRevision', 0)
                data['entriesRevision'] = previous_revision + 1
                calculated = data.get('calculatedSnapshot')
                if (calculated and calculated.get('entriesRevision') == previous_revision
                        and calculated.get('snapshotRevision') == data.get('snapshotRevision', 0)):
                    fresh = [{'id': entry.id, 'row': row} for row, entry, old in zip(rows, refs, existing) if not old.exists]
                    data['calculatedSnapshot'] = apply_holding_entries(calculated, fresh, data['entriesRevision'])
                    data['calculatedSnapshot']['calculatedAt'] = now().isoformat()
                    data['calculationStatus'] = data['calculatedSnapshot']['status']
                else:
                    data['calculationStatus'] = 'stale'
            for row, entry, old in zip(rows, refs, existing):
                if not old.exists:
                    tx.set(entry, {'row': row, 'source': review['source'], 'asOf': review['asOf'], 'importedAt': now()})
        else:
            snapshot = {'rows': rows, 'asOf': review['asOf'], 'source': review['source'], 'importedAt': now().isoformat()}
            old = data.get('snapshot')
            correction = review.get('correction') is True and review['source'] == 'manual-holdings-v1'
            require(not correction or (old and old['asOf'] == snapshot['asOf'] and old['rows'] != rows),
                    '정정 기준일과 변경 내용을 다시 확인하세요.', 409)
            require(correction or not old or old['asOf'] != snapshot['asOf'] or old['rows'] == rows, '같은 기준일의 잔고가 다릅니다. 기존 자료를 확인하세요.', 409)
            replaces_current = not old or old['asOf'] < snapshot['asOf'] or correction
            snapshot['revision'] = data.get('snapshotRevision', 0) + 1
            if correction:
                snapshot.update({'correctionReason': review['correctionReason'], 'changedBy': uid})
            if replaces_current:
                data['snapshot'] = snapshot
            data['snapshotRevision'] = snapshot['revision']
            data['calculationStatus'] = 'stale'
            # Store before/after only in the immutable history, never nest it in
            # the account's current snapshot or expose it in account overviews.
            tx.set(ref.collection('snapshots').document(review['fileHash']), {
                **snapshot, 'previous': old if replaces_current else None,
                'previousAsOf': old.get('asOf') if old and replaces_current else None,
                'changedBy': uid, 'replacedCurrent': replaces_current})
            inserted = len(rows)
        if not data.get('asOf') or data['asOf'] <= review['asOf']:
            data.update({'asOf': review['asOf'], 'source': review['source']})
        tx.set(ref, data)
        tx.set(receipt, {'source': review['source'], 'asOf': review['asOf'], 'importedAt': now(), 'count': len(rows)})
        # Retain the expiring review so a partially completed multi-batch import
        # can retry completed batches through their existing receipts.
        return {'inserted': inserted, 'duplicates': len(rows) - inserted}
    result = apply(db.transaction())
    if not result.get('alreadyImported'):
        current = load(ref)
        if current.get('calculationStatus') == 'stale':
            result.update(rebuild_calculated_snapshot(db, uid, ref.id))
    return result


def validate_import(db, uid, body):
    ref, data = account(db, body.get('accountId'), uid, True)
    review = load(ref.collection('reviews').document(identifier(body.get('reviewId'))))
    require(review['uid'] == uid and review['expiresAt'] > now(), '검토 세션이 만료되었거나 권한이 없습니다.', 410)
    require_statement_identity(review, data, body)
    submitted = body.get('rows')
    _, errors = validate_rows(submitted, review['kind'], review['asOf'], max_rows=10000 if review['source'] == 'toss-pdf' else 200)
    require(not errors, '오류 행을 모두 수정하세요: ' + json.dumps(errors, ensure_ascii=False))
    return {'valid': True}


def overview(db, uid, family_id, ledger_only=False):
    if family_id:
        family_id = identifier(family_id)
    if ledger_only:
        # Permission/revision validation needs neither holdings nor family profiles.
        family(db, family_id, uid)
        query = db.collection('investmentAccounts').where('familyId', '==', family_id).select(
            ['familyId', 'entriesRevision', 'permissions', 'authorityUid', 'ownerId'])
        return {'accounts': [{'id': snap.id, **snap.to_dict()} for snap in read_stream(query) if can_access(snap.to_dict(), uid)]}
    spaces = [{'id': snap.id, **snap.to_dict()} for snap in read_stream(db.collection('familySpaces').where('participantUids', 'array_contains', uid))]
    if not family_id:
        return {'families': spaces}
    # The membership query already read these family documents for this request.
    # Reuse that snapshot instead of issuing another read of the selected family.
    require(any(space['id'] == family_id for space in spaces), '가족 공간 접근 권한이 없습니다.', 403)
    accounts = [{'id': snap.id, **snap.to_dict()} for snap in read_stream(db.collection('investmentAccounts').where('familyId', '==', family_id)) if can_access(snap.to_dict(), uid)]
    return {'families': spaces, 'accounts': accounts, 'summary': summarize(accounts)}


def migrate_legacy(db, uid, body):
    # Non-destructive, retryable copy; never guesses an institution, acquisition basis or balance date.
    ref, data = account(db, body.get('accountId'), uid, True)
    _, space = family(db, data['familyId'], uid)
    require(data['authorityUid'] == uid and space['profiles'][data['ownerId']].get('uid') == uid, '본인 명의 계좌만 이전할 수 있습니다.', 403)
    require(body.get('confirmedSingleAccount') is True, '기존 자료가 이 계좌 한 개의 자료인지 확인하세요.')
    legacy = db.collection('portfolios').document(uid)
    assets = list(read_stream(legacy.collection('assets')))
    rows = []
    for asset in assets:
        for entry in read_stream(asset.reference.collection('transactions')):
            rows.append((f'{asset.id}:{entry.id}', {'legacyAsset': asset.to_dict(), 'legacyTransaction': entry.to_dict(), 'sourcePath': entry.reference.path}))
    require(len(rows) <= 180 and len(assets) <= 100, '대용량 이전은 별도 검토가 필요합니다. 원본 자료는 보존됩니다.')
    @firestore.transactional
    def apply(tx):
        current = load(ref, tx)
        require(current['authorityUid'] == uid and not current.get('asOf') and not current.get('snapshot'), '자료 없는 본인 계좌로만 이전할 수 있습니다.', 409)
        require(not current.get('legacyMigration') or current['legacyMigration']['source'] == legacy.path, '이미 다른 이전 자료가 있습니다.', 409)
        for key, row in rows:
            tx.set(ref.collection('legacyEntries').document(hashlib.sha256(key.encode()).hexdigest()), row)
        for asset in assets:
            tx.set(ref.collection('legacyAssets').document(asset.id), {'original': asset.to_dict(), 'sourcePath': asset.reference.path})
        current['legacyMigration'] = {'source': legacy.path, 'assets': len(assets), 'transactions': len(rows), 'migratedAt': now().isoformat(), 'status': 'unverified-balance-date'}
        tx.set(ref, current)
        return current['legacyMigration']
    return apply(db.transaction())


@app.route('/api/family-portfolio', methods=['GET', 'POST', 'OPTIONS'])
def route():
    if request.method == 'OPTIONS':
        return '', 204
    try:
        header = request.headers.get('Authorization', '')
        require(header.startswith('Bearer '), '로그인이 필요합니다.', 401)
        db = database()
        try:
            claims = auth.verify_id_token(header[7:], check_revoked=True)
        except Exception:
            raise PortfolioError('로그인이 만료되었거나 유효하지 않습니다.', 401)
        uid = claims['uid']
        if request.method == 'GET':
            if request.args.get('view') == 'preferences':
                return jsonify(alert_preferences(db, uid, read_snapshot=read_snapshot))
            if request.args.get('view') == 'statements':
                try:
                    ids = json.loads(request.args.get('accountIds', '[]'))
                except (TypeError, ValueError):
                    raise PortfolioError('계좌 범위를 확인하세요.')
                return jsonify(monthly_reports(db, uid, {'familyId': request.args.get('familyId'), 'accountIds': ids, 'currency': request.args.get('currency')}, load=load, read_snapshot=read_snapshot))
            if request.args.get('accountId'):
                ref, _ = account(db, request.args['accountId'], uid)
                if request.args.get('view') == 'snapshotHistory':
                    collection = ref.collection('snapshots')
                    snapshot_id = request.args.get('snapshotId')
                    if snapshot_id:
                        saved = read_snapshot(collection.document(identifier(snapshot_id)))
                        require(saved.exists, '잔고 이력이 없습니다.', 404)
                        return jsonify({'snapshot': {'id': saved.id, **saved.to_dict()}})
                    query = collection.order_by('__name__')
                    if request.args.get('cursor'):
                        cursor = read_snapshot(collection.document(identifier(request.args['cursor'])))
                        require(cursor.exists, '조회 위치가 유효하지 않습니다.')
                        query = query.start_after(cursor)
                    query = query.select(['asOf', 'source', 'importedAt', 'revision', 'correctionReason', 'previousAsOf', 'replacedCurrent'])
                    history = list(read_stream(query.limit(21)))
                    return jsonify({'snapshots': [{'id': s.id, **s.to_dict()} for s in history[:20]],
                                    'nextCursor': history[19].id if len(history) > 20 else None})
                collection = 'legacyEntries' if request.args.get('legacy') == 'true' else 'entries'
                query = ref.collection(collection).order_by('__name__')
                if request.args.get('cursor'):
                    cursor = read_snapshot(ref.collection(collection).document(identifier(request.args['cursor'])))
                    require(cursor.exists, '조회 위치가 유효하지 않습니다.')
                    query = query.start_after(cursor)
                entries = list(read_stream(query.limit(201)))
                return jsonify({'entries': [{'id': s.id, **s.to_dict()} for s in entries[:200]],
                                'nextCursor': entries[199].id if len(entries) > 200 else None})
            return jsonify(overview(db, uid, request.args.get('familyId'), request.args.get('view') == 'ledger'))
        action = request.args.get('action')
        body = request.get_json(silent=True) or {}
        require(isinstance(body, dict), '요청 형식이 잘못되었습니다.')
        if action == 'preview':
            result = preview(db, uid)
        elif action == 'inspectSpreadsheet':
            result = spreadsheet_inspection(db, uid)
        elif action in {'saveMonthlyStatement', 'deleteMonthlyStatement'}:
            result = change_monthly_report(db, uid, body, load=load, read_snapshot=read_snapshot, now=now, transactional=firestore.transactional, delete=action == 'deleteMonthlyStatement')
        elif action == 'savePreferences':
            result = save_alert_preferences(db, uid, body, read_snapshot=read_snapshot, transactional=firestore.transactional)
        elif action == 'previewManualHoldings':
            result = preview_manual_holdings(db, uid, body)
        elif action == 'ensurePersonal':
            result = ensure_personal_space(db, uid, body)
        elif action == 'createFamily':
            result = create_family(db, uid, body)
        elif action in {'renameFamily', 'renameProfile', 'addMinor', 'invite'}:
            result = mutate_family(db, uid, action, body)
        elif action == 'join':
            result = join_family(db, uid, body)
        elif action == 'createAccount':
            result = create_account(db, uid, body)
        elif action in {'renameAccount', 'grant'}:
            result = edit_account(db, uid, body, action == 'grant')
        elif action == 'commit':
            result = commit(db, uid, body)
        elif action == 'mutateEntry':
            result = mutate_entry(db, uid, body)
        elif action == 'rebuildCalculatedHoldings':
            result = rebuild_calculated_snapshot(db, uid, body.get('accountId'))
        elif action == 'pdfPassword':
            result = save_pdf_password(db, uid, body)
        elif action == 'validateImport':
            result = validate_import(db, uid, body)
        elif action == 'migrateLegacy':
            result = migrate_legacy(db, uid, body)
        else:
            raise PortfolioError('지원하지 않는 동작입니다.')
        return jsonify(result)
    except RequestEntityTooLarge:
        return jsonify({'error': '요청 크기는 3MB 이하이어야 합니다.'}), 413
    except PortfolioError as error:
        return jsonify({'error': str(error)}), error.status
    except ResourceExhausted:
        response = jsonify({'code': 'DATA_RESOURCE_EXHAUSTED', 'error': '데이터베이스 요청이 제한되었습니다. 일시적인 요청 제한 또는 사용량 한도 문제일 수 있습니다. 기존 계좌와 거래내역은 유지됩니다.', 'retryAfterSeconds': 60, 'retryTiming': 'recommended', 'limitType': 'unknown'})
        response.headers['Retry-After'] = '60'
        return response, 429
    except Exception:
        # Never echo provider errors, file contents or identifiers to clients/logs.
        return jsonify({'error': '처리하지 못했습니다. 잠시 후 다시 시도하세요.'}), 503
