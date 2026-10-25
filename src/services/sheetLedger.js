import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { apiUrl } from './apiUrl.js';

// Token exists only for the preview/commit flow in this component's lifetime.
export async function connectGoogleSheet(user) {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
    provider.addScope('https://www.googleapis.com/auth/drive.readonly');
    provider.setCustomParameters({ login_hint: user.email });
    try {
        const result = await reauthenticateWithPopup(user, provider);
        const token =
            GoogleAuthProvider.credentialFromResult(result)?.accessToken;
        if (!token) throw new Error('Google 읽기 권한을 확인하지 못했습니다.');
        return token;
    } catch (error) {
        if (error.code === 'auth/popup-blocked')
            throw new Error(
                'Google 연결 창이 차단되었습니다. 이 사이트의 팝업을 허용하고 다시 분석해 주세요.'
            );
        if (
            [
                'auth/popup-closed-by-user',
                'auth/cancelled-popup-request',
            ].includes(error.code)
        )
            throw new Error(
                'Google 연결이 취소되었습니다. 다시 연결할 수 있습니다.'
            );
        if (error.code === 'auth/user-mismatch')
            throw new Error('현재 관리자와 같은 Google 계정을 선택해 주세요.');
        throw error;
    }
}
export function createSheetLedgerClient({
    fetchImpl = fetch,
    timeoutMs = 45000,
} = {}) {
    let pending = null,
        owner = null,
        cache = null,
        generation = 0;
    function selectUser(user) {
        if (owner !== user) {
            owner = user;
            cache = null;
            pending = null;
            generation++;
        }
    }
    const queryString = (fields) =>
        `?${new URLSearchParams(Object.entries(fields).filter(([, v]) => v != null)).toString()}`;
    const merge = (before, additions) => {
        const byId = new Map(before.map((row) => [row.id, row]));
        for (const row of additions)
            byId.set(row.id, { ...byId.get(row.id), ...row });
        return [...byId.values()];
    };
    async function request(user, method = 'GET', body, query = '') {
        let response;
        try {
            response = await fetchImpl(apiUrl(`/api/sheet-ledger${query}`), {
                method,
                headers: {
                    Authorization: `Bearer ${await user.getIdToken()}`,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError')
                throw new Error(
                    '시트 응답 시간이 초과되었습니다. 잠시 후 다시 분석해 주세요.'
                );
            throw new Error(
                '서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'
            );
        }
        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload !== 'object')
            throw new Error(
                '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'
            );
        if (!response.ok)
            throw Object.assign(
                new Error(payload.error || '시험 장부를 읽지 못했습니다.'),
                { status: response.status, code: payload.code }
            );
        if (!Array.isArray(payload.rows) || !Number.isInteger(payload.version))
            throw new Error(
                '거래 목록 응답 형식이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.'
            );
        if (
            body?.action === 'preview' &&
            (!Array.isArray(payload.excluded) ||
                !Array.isArray(payload.warnings) ||
                typeof payload.fingerprint !== 'string' ||
                typeof payload.cutoff !== 'string')
        )
            throw new Error(
                '분석 결과를 읽지 못했습니다. 잠시 후 다시 분석해 주세요.'
            );
        return payload;
    }
    async function loadAll(user) {
        const current = generation;
        const first = await request(user);
        const rows = [...first.rows],
            observations = [...(first.observations || [])];
        let cursor = first.nextCursor;
        const seen = new Set();
        while (cursor) {
            if (seen.has(cursor))
                throw new Error('장부 페이지 커서가 반복되었습니다.');
            seen.add(cursor);
            const page = await request(
                user,
                'GET',
                undefined,
                queryString({ resource: 'rows', cursor })
            );
            if (page.version !== first.version)
                throw new Error('장부가 변경되었습니다. 다시 조회해 주세요.');
            rows.push(...page.rows);
            cursor = page.nextCursor;
        }
        if (
            first.totalRows != null &&
            (rows.length !== first.totalRows ||
                new Set(rows.map((r) => r.id)).size !== first.totalRows)
        )
            throw new Error(
                '장부 페이지가 누락되거나 중복되었습니다. 다시 조회해 주세요.'
            );
        let readEvidence = false;
        if (first.observationPaging)
            for (const accountId of ['wife', 'husband']) {
                if (
                    !(
                        first.legacyEvidencePageCount ||
                        first.observationStates?.[accountId]?.recordCount
                    )
                )
                    continue;
                cursor = null;
                seen.clear();
                do {
                    const page = await request(
                        user,
                        'GET',
                        undefined,
                        queryString({
                            resource: 'observations',
                            accountId,
                            cursor,
                            version: first.version,
                        })
                    );
                    readEvidence = true;
                    if (!Array.isArray(page.observations))
                        throw new Error('관측 페이지 형식을 확인해 주세요.');
                    observations.push(...page.observations);
                    cursor = page.nextCursor;
                    if (cursor && seen.has(cursor))
                        throw new Error('관측 페이지 커서가 반복되었습니다.');
                    if (cursor) seen.add(cursor);
                } while (cursor);
            }
        if (readEvidence) {
            const final = await request(
                user,
                'GET',
                undefined,
                queryString({ resource: 'version', version: first.version })
            );
            if (final.version !== first.version)
                throw new Error('장부가 변경되었습니다. 다시 조회해 주세요.');
        }
        if (current !== generation || owner !== user)
            throw new Error('로그인 상태가 변경되어 이전 조회를 폐기했습니다.');
        cache = {
            ...first,
            rows,
            observations: merge([], observations),
            nextCursor: null,
        };
        return cache;
    }
    const client = {
        load(user) {
            selectUser(user);
            if (owner === user && pending) return pending;
            const current = generation;
            const active = loadAll(user)
                .catch((error) => {
                    if (current === generation) cache = null;
                    throw error;
                })
                .finally(() => {
                    if (pending === active) pending = null;
                });
            pending = active;
            return active;
        },
        async mutate(user, method, body) {
            selectUser(user);
            const current = ++generation;
            pending = null;
            let result;
            try {
                result = await request(user, method, body);
            } catch (error) {
                if ([401, 403].includes(error.status)) cache = null;
                throw error;
            }
            if (current !== generation || owner !== user)
                throw new Error('로그인 상태가 변경되어 응답을 폐기했습니다.');
            if (
                String(body?.action || '').endsWith('-preview') ||
                body?.action === 'preview'
            )
                return result;
            if (
                result.partial &&
                (!cache ||
                    result.reloadRows ||
                    result.reloadObservations ||
                    result.replayed ||
                    (result.canonicalUnchanged &&
                        result.version !== cache.version))
            ) {
                const loaded = await client.load(user);
                return { ...result, ...loaded };
            }
            const rows = result.partial
                ? merge(cache.rows, result.rowDelta || [])
                : result.rows;
            const observations = merge(cache?.observations || [], [
                ...(result.observations || []),
                ...(result.observationDelta || []),
            ]);
            cache = {
                ...cache,
                ...result,
                rows,
                observations,
                archives: result.archives || cache?.archives || [],
            };
            return cache;
        },
        async detail(user, observation) {
            selectUser(user);
            const current = generation;
            const result = await request(
                user,
                'GET',
                undefined,
                queryString({
                    resource: 'observation',
                    accountId: observation.accountId,
                    id: observation.id,
                })
            );
            if (current !== generation)
                throw new Error(
                    '로그인 상태가 변경되어 원본 조회를 폐기했습니다.'
                );
            const enriched = {
                ...result.observation,
                ...(result.original
                    ? {
                          original: result.original,
                          rawText: result.original.rawText || '',
                      }
                    : {}),
            };
            if (cache)
                cache.observations = merge(cache.observations, [enriched]);
            return enriched;
        },
        archive(user, id) {
            return request(
                user,
                'GET',
                undefined,
                `?sourceArchive=${encodeURIComponent(id)}`
            );
        },
        clear() {
            generation++;
            pending = null;
            owner = null;
            cache = null;
        },
    };
    return client;
}
