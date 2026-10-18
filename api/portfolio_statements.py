"""Private, user-reviewed monthly snapshots and alert preferences; never an accounting source."""
import re
from api.family_portfolio_service import can_access, digest, identifier, iso_date, require


def _count(value):
    return type(value) is int and 0 <= value <= 1000000


def normalize_statement(value):
    keys = ('schemaVersion', 'kind', 'month', 'asOf', 'currency', 'scopeHash', 'accountCount', 'recordCount', 'unknownCount', 'knownAmount', 'excludedDateCount')
    require(isinstance(value, dict) and all(key in value for key in keys) and type(value.get('schemaVersion')) is int and value.get('schemaVersion') == 1 and value.get('kind') == 'yieldloom-monthly-dividends', '결산 형식을 확인하세요.')
    month = value.get('month')
    require(isinstance(month, str) and re.fullmatch(r'\d{4}-\d{2}', month), '결산 월을 확인하세요.')
    iso_date(month + '-01')
    as_of = iso_date(value.get('asOf'))
    require(type(value['asOf']) is str and value['asOf'] == as_of, '결산 확인일 형식을 확인하세요.')
    require(month <= as_of[:7], '결산 확인일을 확인하세요.')
    currency = value.get('currency')
    require(isinstance(currency, str) and re.fullmatch(r'[A-Z]{3}', currency), '결산 통화를 확인하세요.')
    require(isinstance(value.get('scopeHash'), str) and re.fullmatch(r'[a-f0-9]{64}', value['scopeHash']), '결산 범위를 확인하세요.')
    require(all(_count(value.get(key)) for key in ('accountCount', 'recordCount', 'unknownCount', 'excludedDateCount')) and value['accountCount'] > 0 and value['unknownCount'] <= value['recordCount'], '결산 기록 수를 확인하세요.')
    known = value['recordCount'] - value['unknownCount']
    amount = value.get('knownAmount')
    require(amount is None if known == 0 else type(amount) in (int, float) and -1e19 <= amount <= 1e19, '결산 금액을 확인하세요.')
    return {key: value[key] for key in ('schemaVersion', 'kind', 'month', 'asOf', 'currency', 'scopeHash', 'accountCount', 'recordCount', 'unknownCount', 'knownAmount', 'excludedDateCount')}


def _scope(db, uid, body):
    family_id = identifier(body.get('familyId'))
    ids = body.get('accountIds')
    require(isinstance(ids, list) and 0 < len(ids) <= 100 and all(isinstance(item, str) for item in ids) and len(set(ids)) == len(ids), '계좌 범위는 중복 없이 1~100개로 선택하세요.')
    ids = sorted(identifier(item) for item in ids)
    currency = body.get('currency')
    require(isinstance(currency, str) and re.fullmatch(r'[A-Z]{3}', currency), '통화를 확인하세요.')
    scope_hash = digest([uid, family_id, ids])
    private = db.collection('portfolioPrivateUsers').document(digest(uid))
    ref = private.collection('statementScopes').document(digest([scope_hash, currency]))
    return ref, family_id, ids, currency, scope_hash


def _allowed(db, uid, family_id, ids, load, tx=None, revisions=None):
    space = load(db.collection('familySpaces').document(family_id), tx)
    require(uid in space.get('participantUids', []), '가족 접근 권한이 변경되었습니다.', 403)
    current = {}
    for key in ids:
        data = load(db.collection('investmentAccounts').document(key), tx)
        require(data.get('familyId') == family_id and can_access(data, uid), '계좌 접근 권한이 변경되었습니다.', 403)
        current[key] = data.get('entriesRevision', 0)
        if revisions is not None:
            require(type(revisions.get(key)) is int and revisions[key] == current[key], '거래 원장이 변경되었습니다. 계좌와 배당 분석을 새로고침하세요.', 409)
    return current


def _public(data, revisions):
    result = []
    for item in data.get('reports', {}).values():
        result.append({'statement': item['statement'], 'revision': item['revision'], 'savedAt': item['savedAt'],
                       'stale': item.get('accountRevisions') != revisions})
    return {'reports': sorted(result, key=lambda item: item['statement']['month'], reverse=True)}


def monthly_reports(db, uid, body, *, load, read_snapshot):
    ref, family_id, ids, _, _ = _scope(db, uid, body)
    snap = read_snapshot(ref)
    revisions = _allowed(db, uid, family_id, ids, load)
    return _public(snap.to_dict() if snap.exists else {}, revisions)


def change_monthly_report(db, uid, body, *, load, read_snapshot, now, transactional, delete=False):
    ref, family_id, ids, currency, scope_hash = _scope(db, uid, body)
    month = body.get('month')
    require(isinstance(month, str) and re.fullmatch(r'\d{4}-\d{2}', month), '결산 월을 확인하세요.')
    iso_date(month + '-01')
    expected = body.get('expectedRevision')
    require(type(expected) is int and expected >= 0, '결산 변경 번호를 확인하세요.')
    report = None if delete else normalize_statement(body.get('statement'))
    if report:
        require(report['scopeHash'] == scope_hash and report['accountCount'] == len(ids) and report['currency'] == currency and report['month'] == month, '현재 계좌·통화·월과 결산이 다릅니다.')
        require(isinstance(body.get('accountRevisions'), dict) and set(body['accountRevisions']) == set(ids), '계좌 원장 버전을 확인하세요.')

    @transactional
    def apply(tx):
        snap = read_snapshot(ref, tx)
        data = snap.to_dict() if snap.exists else {'ownerUid': uid, 'familyId': family_id, 'accountIds': ids, 'reports': {}}
        revisions = _allowed(db, uid, family_id, ids, load, tx, None if delete else body['accountRevisions'])
        reports = data.get('reports', {})
        old = reports.get(month)
        if not delete and old and old['statement'] == report and old.get('accountRevisions') == revisions:
            return _public(data, revisions) | {'unchanged': True}
        require((old['revision'] if old else 0) == expected, '다른 작업에서 결산이 변경되었습니다. 보관함을 다시 열어 주세요.', 409)
        if delete:
            if not old:
                return _public(data, revisions) | {'unchanged': True}
            del reports[month]
        else:
            require(old or len(reports) < 24, '범위별 결산은 24개까지 보관합니다. 필요 없는 결산을 먼저 삭제하세요.')
            reports[month] = {'statement': report, 'revision': data.get('revision', 0) + 1, 'savedAt': now().isoformat(), 'accountRevisions': revisions}
        data['revision'] = data.get('revision', 0) + 1
        data['reports'] = reports
        tx.set(ref, data)
        return _public(data, revisions) | {'unchanged': False}
    return apply(db.transaction())


DEFAULT_PREFERENCES = {'enabled': False, 'leadDays': 3, 'browser': False}


def alert_preferences(db, uid, *, read_snapshot):
    ref = db.collection('portfolioPrivateUsers').document(digest(uid))
    snap = read_snapshot(ref)
    data = snap.to_dict() if snap.exists else {}
    return {'preferences': data.get('preferences', DEFAULT_PREFERENCES), 'revision': data.get('revision', 0)}


def save_alert_preferences(db, uid, body, *, read_snapshot, transactional):
    prefs = body.get('preferences')
    require(isinstance(prefs, dict) and set(prefs) == set(DEFAULT_PREFERENCES) and type(prefs['enabled']) is bool and type(prefs['browser']) is bool and type(prefs['leadDays']) is int and prefs['leadDays'] in {1, 3, 7}, '알림 설정을 확인하세요.')
    require(type(body.get('expectedRevision')) is int and body['expectedRevision'] >= 0, '알림 변경 번호를 확인하세요.')
    ref = db.collection('portfolioPrivateUsers').document(digest(uid))
    @transactional
    def apply(tx):
        snap = read_snapshot(ref, tx)
        old = snap.to_dict() if snap.exists else {}
        revision = old.get('revision', 0)
        if old.get('preferences', DEFAULT_PREFERENCES) == prefs:
            return {'preferences': prefs, 'revision': revision}
        require(revision == body['expectedRevision'], '다른 작업에서 알림 설정이 변경되었습니다. 다시 조회하세요.', 409)
        tx.set(ref, {'ownerUid': uid, 'preferences': prefs, 'revision': revision + 1})
        return {'preferences': prefs, 'revision': revision + 1}
    return apply(db.transaction())
