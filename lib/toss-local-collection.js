import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ConnectionError, accountDigest } from './account-toss-connection.js';
import { localHash } from './toss-local-grants.js';
import { validateManualOptions } from '../scripts/toss/read-account-orders.mjs';
import {
    parseTossOrderPage,
    tossRetryDelay,
} from '../scripts/toss/collect-closed-orders.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
    throw new ConnectionError(code, 409);
};
const result = (claims, session, reason, failureStage) => ({
    accountId: claims.accountId,
    status: 'collected_locally',
    canonicalUnchanged: true,
    cloudSaved: false,
    collectionPending: !session.done,
    ...(reason ? { stopReason: reason } : {}),
    ...(failureStage ? { failureStage } : {}),
});

// Companion-only collector: raw bytes never pass through the legacy plaintext
// filesystem collector. Its established page validator is reused unchanged.
export async function collectEncryptedOrders({
    vault,
    credentials,
    claims,
    input,
    authorize,
    fetchImpl = fetch,
    now = Date.now,
    sleep = (ms) => delay(ms),
}) {
    if (
        !validateManualOptions({
            accountSuffix: claims.suffix,
            status: 'BOTH',
            from: input.from,
            to: input.to,
        })
    )
        fail('INVALID_REQUEST');
    const initial = await vault.read();
    const activeId = initial.activeCollections?.[claims.accountId];
    const previous = initial.collections?.[activeId];
    if (
        previous &&
        (!previous.done || previous.pages.some((p) => p.ackOffset < p.count))
    ) {
        if (
            previous.from !== input.from ||
            previous.to !== input.to ||
            previous.accountNoSha256 !== claims.accountNoSha256 ||
            previous.subjectUid !== claims.subjectUid
        )
            fail('LOCAL_COLLECTION_SCOPE_MISMATCH');
        if (previous.pages.some((p) => p.ackOffset < p.count))
            return result(claims, previous, 'RESUME_ARCHIVE');
        if (previous.notBefore - now() + 5000 >= claims.exp - now())
            return result(claims, previous, 'PROVIDER_COOLDOWN');
    }
    const binding = initial.bindings[claims.accountId];
    return credentials.withExistingToken(
        binding.credentialRef,
        async (token, journal) => {
            if (!journal?.persist) fail('LOCAL_STORAGE_REQUIRED');
            const { state, persist } = journal;
            const current = state.bindings[claims.accountId];
            if (
                !current?.enabled ||
                current.subjectUid !== claims.subjectUid ||
                current.accountNoSha256 !== claims.accountNoSha256 ||
                current.revision !== claims.bindingRevision ||
                current.credentialRef !== binding.credentialRef ||
                state.clients[binding.credentialRef]?.subjectUid !==
                    claims.subjectUid
            )
                fail('STALE_BINDING');
            state.collections ??= {};
            state.activeCollections ??= {};
            let session =
                state.collections[state.activeCollections[claims.accountId]];
            if (
                !session ||
                (session.done &&
                    session.pages.every((p) => p.ackOffset === p.count))
            ) {
                const id = randomBytes(24).toString('hex');
                session = {
                    id,
                    accountId: claims.accountId,
                    accountNoSha256: claims.accountNoSha256,
                    subjectUid: claims.subjectUid,
                    from: input.from,
                    to: input.to,
                    scope: 'OPEN',
                    cursor: null,
                    pages: [],
                    seen: [],
                    done: false,
                    notBefore: 0,
                };
                state.collections[id] = session;
                state.activeCollections[claims.accountId] = id;
            }
            let failureStage = 'ACCOUNTS';
            async function request(path, scope) {
                failureStage = scope || 'ACCOUNTS';
                const expiredCode =
                    scope === 'OPEN'
                        ? 'OPEN_RESPONSE_LIMIT'
                        : scope === 'CLOSED'
                          ? 'GRANT_WINDOW'
                          : 'ACCOUNT_LOOKUP_WINDOW';
                await authorize();
                const remaining = claims.exp - now();
                if (remaining <= 0) fail(expiredCode);
                const response = await fetchImpl(
                    'https://openapi.tossinvest.com' + path,
                    {
                        method: 'GET',
                        redirect: 'error',
                        signal: AbortSignal.timeout(
                            Math.max(1, Math.min(30000, remaining))
                        ),
                        headers: {
                            Authorization: `Bearer ${token}`,
                            ...(scope
                                ? {
                                      'X-Tossinvest-Account': String(
                                          session.accountSeq
                                      ),
                                  }
                                : {}),
                        },
                    }
                );
                if (!response.ok) {
                    await response.body?.cancel();
                    if ([401, 403].includes(response.status))
                        fail('AUTHORIZATION_REQUIRED');
                    session.notBefore =
                        now() +
                        Math.max(1100, tossRetryDelay(response.headers, now()));
                    await persist();
                    fail(
                        response.status === 429
                            ? 'PROVIDER_COOLDOWN'
                            : 'LOCAL_SYNC_FAILED'
                    );
                }
                if (
                    scope &&
                    response.headers.get('x-ratelimit-remaining') === '0'
                ) {
                    session.notBefore = Math.max(
                        session.notBefore,
                        now() +
                            Math.max(
                                1100,
                                tossRetryDelay(response.headers, now())
                            )
                    );
                }
                const reader = response.body.getReader(),
                    chunks = [];
                let size = 0;
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (now() >= claims.exp) fail(expiredCode);
                        if (done) break;
                        size += value.byteLength;
                        if (size > (scope ? 20000000 : 1000000))
                            fail(
                                scope === 'OPEN'
                                    ? 'OPEN_RESPONSE_LIMIT'
                                    : scope === 'CLOSED'
                                      ? 'LOCAL_RESPONSE_TOO_LARGE'
                                      : 'ACCOUNT_LOOKUP_RESPONSE_LIMIT'
                            );
                        chunks.push(Buffer.from(value));
                    }
                } catch (error) {
                    await reader.cancel().catch(() => {});
                    throw error;
                }
                await authorize();
                return Buffer.concat(chunks);
            }
            try {
                const accounts = JSON.parse(
                    new TextDecoder('utf-8', { fatal: true }).decode(
                        await request('/api/v1/accounts')
                    )
                );
                const matches =
                    Array.isArray(accounts?.result) && !accounts.error
                        ? accounts.result.filter(
                              (a) =>
                                  a.accountType === 'BROKERAGE' &&
                                  typeof a.accountNo === 'string' &&
                                  a.accountNo.endsWith(claims.suffix) &&
                                  accountDigest(a.accountNo) ===
                                      claims.accountNoSha256 &&
                                  Number.isSafeInteger(a.accountSeq) &&
                                  a.accountSeq > 0
                          )
                        : [];
                if (matches.length !== 1) fail('ACCOUNT_VERIFICATION_REQUIRED');
                const seqHash = accountDigest(matches[0].accountSeq);
                if (
                    session.accountSeqHash &&
                    session.accountSeqHash !== seqHash
                )
                    fail('STALE_BINDING');
                session.accountSeqHash = seqHash;
                // accountSeq remains encrypted with the checkpoint, never in a filename/response.
                session.accountSeq = matches[0].accountSeq;
                await persist();
                for (let page = 0; !session.done && page < 25; page++) {
                    if (session.pages.length >= 10000) fail('LOCAL_PAGE_LIMIT');
                    const wait = Math.max(0, session.notBefore - now());
                    if (claims.exp - now() <= wait + 5000)
                        return result(claims, session, 'GRANT_WINDOW');
                    if (wait) await sleep(wait);
                    const query = new URLSearchParams({
                        status: session.scope,
                    });
                    if (session.scope === 'CLOSED') {
                        query.set('limit', '100');
                        query.set('from', input.from);
                        query.set('to', input.to);
                        if (session.cursor !== null)
                            query.set('cursor', session.cursor);
                    }
                    const scope = session.scope,
                        cursor = session.cursor;
                    const bytes = await request(
                        '/api/v1/orders?' + query,
                        scope
                    );
                    const parsed = parseTossOrderPage(
                        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                        token,
                        scope
                    );
                    if (
                        scope === 'CLOSED' &&
                        parsed.nextCursor !== null &&
                        (parsed.nextCursor === cursor ||
                            session.seen.includes(parsed.nextCursor))
                    )
                        fail('LOCAL_CURSOR_REPEATED');
                    const pageHash = digest(bytes),
                        archiveId = localHash({
                            run: session.id,
                            scope,
                            cursor,
                            pageHash,
                        });
                    // Immutable ciphertext first, then the encrypted checkpoint. A crash
                    // can leave an orphan ciphertext; it cannot advance past absent raw.
                    await vault.writeArchive(archiveId, bytes);
                    session.pages.push({
                        archiveId,
                        pageHash,
                        scope,
                        cursor,
                        nextCursor: parsed.nextCursor,
                        count: parsed.orders.length,
                        ackOffset: 0,
                    });
                    session.notBefore = Math.max(
                        session.notBefore,
                        now() + 1100
                    );
                    if (scope === 'OPEN') {
                        session.scope = 'CLOSED';
                        session.cursor = null;
                    } else {
                        if (cursor !== null) session.seen.push(cursor);
                        session.cursor = parsed.nextCursor;
                        session.done = !parsed.hasNext;
                    }
                    await persist();
                }
                return result(
                    claims,
                    session,
                    session.done ? undefined : 'PAGE_BUDGET'
                );
            } catch (error) {
                // Expiry cannot erase a successfully encrypted earlier page/cursor.
                // No automatic retry/token issuance/authorization renewal occurs here.
                await persist();
                const timedOut = ['TimeoutError', 'AbortError'].includes(
                    error?.name
                );
                const code =
                    error instanceof ConnectionError &&
                    !(
                        error.code === 'LOCAL_GRANT_REJECTED' &&
                        now() >= claims.exp
                    )
                        ? error.code
                        : now() >= claims.exp || timedOut
                          ? failureStage === 'ACCOUNTS'
                              ? now() >= claims.exp
                                  ? 'ACCOUNT_LOOKUP_WINDOW'
                                  : 'ACCOUNT_LOOKUP_TIMEOUT'
                              : failureStage === 'OPEN'
                                ? 'OPEN_RESPONSE_LIMIT'
                                : timedOut && now() < claims.exp
                                  ? 'PROVIDER_TIMEOUT'
                                  : 'GRANT_WINDOW'
                          : 'LOCAL_SYNC_FAILED';
                if (
                    [
                        'OPEN_RESPONSE_LIMIT',
                        'GRANT_WINDOW',
                        'PROVIDER_COOLDOWN',
                        'PROVIDER_TIMEOUT',
                        'ACCOUNT_LOOKUP_TIMEOUT',
                        'ACCOUNT_LOOKUP_WINDOW',
                    ].includes(code)
                )
                    return result(claims, session, code, failureStage);
                throw new ConnectionError(code, 409);
            }
        }
    );
}

export async function materializeArchiveBatch(vault, state, claims) {
    const session =
        state.collections?.[state.activeCollections?.[claims.accountId]];
    if (!session) return null;
    if (
        session.accountNoSha256 !== claims.accountNoSha256 ||
        session.subjectUid !== claims.subjectUid
    )
        fail('STALE_BINDING');
    const pageIndex = session.pages.findIndex((p) => p.ackOffset < p.count);
    if (pageIndex < 0) return null;
    const page = session.pages[pageIndex],
        bytes = await vault.readArchive(page.archiveId);
    if (digest(bytes) !== page.pageHash) fail('LOCAL_ARCHIVE_INVALID');
    const raw = parseTossOrderPage(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        undefined,
        page.scope
    );
    if (raw.orders.length !== page.count || raw.nextCursor !== page.nextCursor)
        fail('LOCAL_ARCHIVE_INVALID');
    const records = [];
    for (
        let position = page.ackOffset;
        position < raw.orders.length && records.length < 50;
        position++
    ) {
        const record = {
            original: raw.orders[position],
            pageHash: page.pageHash,
            position,
            scope: page.scope,
        };
        if (Buffer.byteLength(JSON.stringify(record)) > 300000)
            fail('LOCAL_RECORD_TOO_LARGE');
        if (Buffer.byteLength(JSON.stringify([...records, record])) > 300000)
            break;
        records.push(record);
    }
    const body = {
        accountId: claims.accountId,
        accountNoSha256: claims.accountNoSha256,
        bindingRevision: claims.bindingRevision,
        records,
    };
    return {
        ...body,
        batchId: localHash(body),
        archiveProgress: {
            runId: session.id,
            pageIndex,
            offset: page.ackOffset,
            count: records.length,
        },
    };
}
