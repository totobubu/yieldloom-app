// Read-only, paginated account access. Private rows remain in the caller's scope.
export async function loadCalendarLedger({
    request,
    familyId,
    accounts,
    signal,
    isCurrent = () => true,
}) {
    const check = () => {
        if (signal?.aborted || !isCurrent())
            throw new DOMException('조회를 취소했습니다.', 'AbortError');
    };
    check();
    const before = await request('', undefined, { familyId }, { signal });
    check();
    const revisions = new Map(
        before.accounts.map((a) => [a.id, a.entriesRevision ?? 0])
    );
    if (accounts.some((a) => !revisions.has(a.id)))
        throw new Error(
            '계좌 조회 권한이 변경되었습니다. 계좌 목록을 새로고침해 주세요.'
        );
    const entries = [];
    for (const account of accounts) {
        const cursors = new Set(),
            ids = new Set();
        let cursor;
        do {
            const page = await request(
                '',
                undefined,
                {
                    accountId: account.id,
                    legacy: 'false',
                    ...(cursor ? { cursor } : {}),
                },
                { signal }
            );
            check();
            for (const entry of page.entries) {
                if (!entry.id || ids.has(entry.id))
                    throw new Error(
                        '조회 중 거래 목록이 변경되었습니다. 다시 조회해 주세요.'
                    );
                ids.add(entry.id);
                entries.push({ ...entry, accountId: account.id });
            }
            if (entries.length > 10000)
                throw new Error(
                    '배당 거래 조회는 전체 10,000행까지 지원합니다. 계좌를 하나씩 선택해 주세요.'
                );
            cursor = page.nextCursor;
            if (cursor && cursors.has(cursor))
                throw new Error(
                    '다음 거래를 조회하지 못했습니다. 다시 시도해 주세요.'
                );
            if (cursor) cursors.add(cursor);
        } while (cursor);
    }
    const after = await request('', undefined, { familyId }, { signal });
    check();
    for (const account of accounts) {
        const latest = after.accounts.find((a) => a.id === account.id);
        if (
            !latest ||
            (latest.entriesRevision ?? 0) !== revisions.get(account.id)
        )
            throw new Error(
                '조회 중 계좌 권한 또는 거래 목록이 변경되었습니다. 다시 조회해 주세요.'
            );
    }
    return entries;
}
