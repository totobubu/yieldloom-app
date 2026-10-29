import { apiUrl } from './apiUrl.js';
import { validSourceTimeItems } from '../../lib/sheet-source-times.js';
import { validFinalRow } from '../../lib/final-ledger-view.js';

export function createSheetReportClient({
    fetchImpl = fetch,
    now = Date.now,
} = {}) {
    const cache = new Map(),
        pending = new Map();
    let owner = null,
        generation = 0;
    function clear() {
        generation++;
        owner = null;
        cache.clear();
        pending.clear();
    }
    function select(user) {
        if (owner !== user) {
            clear();
            owner = user;
        }
    }
    async function load(
        user,
        accountId,
        section = 'summary',
        { refresh = false, observationId = null } = {}
    ) {
        select(user);
        if (
            !user ||
            !['wife', 'husband'].includes(accountId) ||
            !['summary', 'details', 'times', 'followup', 'final'].includes(
                section
            ) ||
            (observationId !== null &&
                (section !== 'final' || !/^[a-f0-9]{64}$/.test(observationId)))
        )
            throw new Error('로그인과 계좌를 확인해 주세요.');
        const key = `${accountId}:${section}${observationId ? ':' + observationId : ''}`;
        if (pending.has(key)) return pending.get(key);
        if (!refresh && cache.get(key)?.expires > now())
            return cache.get(key).value;
        const current = generation;
        const task = (async () => {
            const query = new URLSearchParams({
                view: 'sheet-reports',
                accountId,
                section,
            });
            if (observationId) query.set('observationId', observationId);
            const response = await fetchImpl(
                apiUrl(`/api/portfolio-capital?${query}`),
                {
                    headers: {
                        Authorization: `Bearer ${await user.getIdToken()}`,
                    },
                    signal: AbortSignal.timeout(
                        section === 'final' && !observationId ? 60_000 : 30_000
                    ),
                    cache: 'no-store',
                }
            );
            const value = await response.json();
            if (!response.ok) {
                if (
                    [401, 403].includes(response.status) &&
                    current === generation
                )
                    clear();
                throw Object.assign(
                    new Error(
                        value.error || '비공개 대조 보고서 조회에 실패했습니다.'
                    ),
                    { status: response.status, code: value.code }
                );
            }
            if (current !== generation || owner !== user)
                throw new Error(
                    '로그인 상태가 변경되어 보고서를 폐기했습니다.'
                );
            if (
                value.accountId !== accountId ||
                value.section !== section ||
                value.readOnly !== true
            )
                throw new Error('보고서 계좌 또는 형식을 확인해 주세요.');
            if (
                section === 'times' &&
                !validSourceTimeItems(value.items, accountId)
            )
                throw new Error('원문 시각 보고서 형식을 확인해 주세요.');
            if (
                section === 'followup' &&
                (value.schemaVersion !== 2 ||
                    value.integrity?.verified !== true ||
                    !/^[a-f0-9]{64}$/.test(
                        value.integrity?.checkpointSha256 || ''
                    ) ||
                    !Array.isArray(value.observations) ||
                    value.observations.some((o) => o.accountId !== accountId) ||
                    !Array.isArray(value.orders) ||
                    value.orders.some((o) => o.account !== accountId) ||
                    !Array.isArray(value.remainingEightRows))
            )
                throw new Error(
                    '후속 보고서 버전·검증·계좌 형식을 확인해 주세요.'
                );
            if (
                section === 'final' &&
                (value.schemaVersion !== 1 ||
                    value.adopted !== true ||
                    value.comparisonRequired !== false ||
                    !/^[a-f0-9]{64}$/.test(value.releaseId || '') ||
                    (observationId
                        ? value.detail?.id !== observationId
                        : !Array.isArray(value.rows) ||
                          value.rows.length > 10000 ||
                          value.rows.some(
                              (r) => !validFinalRow(r, accountId)
                          ) ||
                          !Array.isArray(value.unassignedRows) ||
                          value.unassignedRows.length > 1000 ||
                          value.unassignedRows.some(
                              (r) => !validFinalRow(r, 'unassigned')
                          )))
            )
                throw new Error('최종 거래 자료의 형식을 확인해 주세요.');
            if (cache.size >= 40) cache.delete(cache.keys().next().value);
            cache.set(key, {
                value,
                expires: now() + (section === 'times' ? 300_000 : 30_000),
            });
            return value;
        })()
            .catch((error) => {
                if (String(error.code || '').startsWith('auth/')) {
                    if (current === generation) clear();
                    error.status = 401;
                }
                throw error;
            })
            .finally(() => {
                if (pending.get(key) === task) pending.delete(key);
            });
        pending.set(key, task);
        return task;
    }
    return { load, clear };
}
