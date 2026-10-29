#!/usr/bin/env node
/** Local observations only. Token issuance requires explicit CLI opt-in. */
import { createHash, randomUUID } from 'node:crypto';
import {
    mkdir,
    open,
    readFile,
    readdir,
    rename,
    unlink,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const ORIGIN = 'https://openapi.tossinvest.com';
const SPEC = `${ORIGIN}/openapi-docs/latest/openapi.json`;
const FORMAT = 1;
const MAX_BODY = 20 * 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString();
const decimal = /^-?\d+(?:\.\d+)?$/;
const reasons = new Set([
    'authentication_failed',
    'http_error',
    'retry_exhausted',
    'cooldown',
    'interrupted',
    'invalid_response',
    'cursor_repeated',
    'storage_error',
    'invalid_archive',
    'configuration_mismatch',
    'locked',
    'invalid_options',
]);

class Stop extends Error {
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}
const stop = (reason) => {
    throw new Stop(reason);
};

async function atomicJson(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
        await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
        await file.sync();
    } finally {
        await file.close();
    }
    try {
        await rename(temporary, path);
    } finally {
        await unlink(temporary).catch(() => {});
    }
}

function validateOrder(order) {
    if (!order || typeof order !== 'object' || Array.isArray(order))
        stop('invalid_response');
    for (const field of [
        'orderId',
        'symbol',
        'side',
        'orderType',
        'timeInForce',
        'status',
        'currency',
        'orderedAt',
    ]) {
        if (typeof order[field] !== 'string' || !order[field])
            stop('invalid_response');
    }
    if (typeof order.quantity !== 'string' || !decimal.test(order.quantity))
        stop('invalid_response');
    if (
        !order.execution ||
        typeof order.execution !== 'object' ||
        Array.isArray(order.execution)
    )
        stop('invalid_response');
    for (const field of [
        'filledQuantity',
        'averageFilledPrice',
        'filledAmount',
        'commission',
        'tax',
        'filledAt',
        'settlementDate',
    ]) {
        if (!Object.hasOwn(order.execution, field)) stop('invalid_response');
    }
    if (typeof order.execution.filledQuantity !== 'string')
        stop('invalid_response');
    for (const [object, fields] of [
        [order, ['price', 'orderAmount']],
        [
            order.execution,
            [
                'filledQuantity',
                'averageFilledPrice',
                'filledAmount',
                'commission',
                'tax',
            ],
        ],
    ]) {
        for (const field of fields) {
            if (
                object[field] !== undefined &&
                object[field] !== null &&
                (typeof object[field] !== 'string' ||
                    !decimal.test(object[field]))
            )
                stop('invalid_response');
        }
    }
    for (const [object, fields] of [
        [order, ['canceledAt']],
        [order.execution, ['filledAt', 'settlementDate']],
    ]) {
        for (const field of fields)
            if (
                object[field] !== undefined &&
                object[field] !== null &&
                typeof object[field] !== 'string'
            )
                stop('invalid_response');
    }
}

function parsePage(raw, token, status = 'CLOSED') {
    // Never archive credentials accidentally reflected by an upstream service.
    if (token && raw.includes(token)) stop('invalid_response');
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        stop('invalid_response');
    }
    const inspect = (value) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (
                /^(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)$/i.test(
                    key
                )
            )
                stop('invalid_response');
            inspect(child);
        }
    };
    inspect(payload);
    const result = payload?.result;
    if (
        payload?.error ||
        !result ||
        !Array.isArray(result.orders) ||
        typeof result.hasNext !== 'boolean'
    )
        stop('invalid_response');
    if (
        result.hasNext
            ? typeof result.nextCursor !== 'string' || !result.nextCursor
            : result.nextCursor !== null
    )
        stop('invalid_response');
    if (status === 'OPEN' && (result.hasNext || result.nextCursor !== null))
        stop('invalid_response');
    for (const order of result.orders) validateOrder(order);
    return result;
}

function optionsFor({
    accountSeq,
    run = 'initial',
    from = null,
    to = null,
    limit = 100,
    maxPages = 10000,
    intervalMs = 1100,
    maxRetries = 3,
    status = 'CLOSED',
}) {
    if (
        !['CLOSED', 'OPEN'].includes(status) ||
        (status === 'OPEN' &&
            (typeof run !== 'string' || !run.startsWith('open-')))
    )
        stop('invalid_options');
    if (
        typeof accountSeq !== 'string' ||
        !/^[1-9]\d*$/.test(accountSeq) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(run)
    )
        stop('invalid_options');
    for (const date of [from, to]) {
        if (
            date !== null &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !==
                    date)
        )
            stop('invalid_options');
    }
    if (from && to && from > to) stop('invalid_options');
    if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(maxPages) ||
        maxPages < 1 ||
        maxPages > 1000000 ||
        !Number.isFinite(intervalMs) ||
        intervalMs < 1000 ||
        !Number.isInteger(maxRetries) ||
        maxRetries < 0 ||
        maxRetries > 5
    )
        stop('invalid_options');
    return {
        accountHash: hash(accountSeq),
        run,
        query:
            status === 'OPEN'
                ? { status, from, to }
                : { status, limit, from, to },
        maxPages,
        intervalMs,
        maxRetries,
    };
}

function retryDelay(headers, now = Date.now()) {
    const after = headers.get('retry-after');
    const reset = headers.get('x-ratelimit-reset'); // Toss defines seconds until next token, not an epoch.
    const seconds = /^\d+(?:\.\d+)?$/.test(after ?? '')
        ? Number(after)
        : Math.max(0, (Date.parse(after) - now) / 1000) || 0;
    return Math.max(
        seconds * 1000,
        /^\d+(?:\.\d+)?$/.test(reset ?? '') ? Number(reset) * 1000 : 0
    );
}

async function responseBytes(response) {
    const reader = response.body?.getReader();
    if (!reader) stop('invalid_response');
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_BODY) stop('invalid_response');
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
}

async function requestPage(context, cursor) {
    const { opts, accountSeq, token, fetchImpl, sleep, signal, directory } =
        context;
    const url = new URL('/api/v1/orders', ORIGIN);
    for (const [key, value] of Object.entries(opts.query))
        if (value !== null) url.searchParams.set(key, String(value));
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        if (signal?.aborted) stop('interrupted');
        try {
            const { notBefore } = JSON.parse(
                await readFile(join(directory, 'rate-limit.json'), 'utf8')
            );
            if (!Number.isFinite(notBefore)) stop('invalid_archive');
            const wait = notBefore - Date.now();
            if (wait > 60000) stop('cooldown');
            if (wait > 0) await sleep(wait, signal);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        // Rate pacing also applies after process restarts and to retries.
        await sleep(opts.intervalMs, signal);
        let response;
        let bytes;
        try {
            const requestSignal = signal
                ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
                : AbortSignal.timeout(30000);
            response = await fetchImpl(url, {
                method: 'GET',
                redirect: 'error',
                signal: requestSignal,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Tossinvest-Account': accountSeq,
                    Accept: 'application/json',
                },
            });
            if (response.ok) bytes = await responseBytes(response);
        } catch (error) {
            if (signal?.aborted) stop('interrupted');
            if (error instanceof Stop) throw error;
            if (attempt === opts.maxRetries) stop('retry_exhausted');
            await sleep(1000 * 2 ** attempt, signal);
            continue;
        }
        if (response.ok) {
            const cooldown =
                response.headers.get('x-ratelimit-remaining') === '0'
                    ? retryDelay(response.headers)
                    : 0;
            if (cooldown)
                await atomicJson(join(directory, 'rate-limit.json'), {
                    notBefore: Date.now() + cooldown,
                });
            return { bytes };
        }
        // Error bodies and headers are never logged or persisted.
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403)
            stop('authentication_failed');
        if (![429, 500, 502, 503, 504].includes(response.status))
            stop('http_error');
        const wait = Math.max(
            retryDelay(response.headers),
            1000 * 2 ** attempt
        );
        await atomicJson(join(directory, 'rate-limit.json'), {
            notBefore: Date.now() + wait,
        });
        if (wait > 60000) stop('cooldown'); // Persist a partial result instead of capping a server cooldown.
        if (attempt === opts.maxRetries) stop('retry_exhausted');
    }
}

function ingest(state, receipt, name, opts) {
    if (
        receipt.format !== FORMAT ||
        receipt.accountHash !== opts.accountHash ||
        receipt.cursor !== state.cursor ||
        typeof receipt.bodyBase64 !== 'string'
    )
        stop('invalid_archive');
    const bytes = Buffer.from(receipt.bodyBase64, 'base64');
    if (hash(bytes) !== receipt.sha256) stop('invalid_archive');
    let result;
    try {
        result = parsePage(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
            undefined,
            opts.query.status
        );
    } catch {
        stop('invalid_archive');
    }
    state.pages++;
    for (const [position, order] of result.orders.entries()) {
        // Index contains references and exact known string fields; full bytes remain in the page receipt.
        const reference = {
            page: name,
            position,
            sha256: hash(JSON.stringify(order)),
            status: order.status,
            quantity: order.quantity,
            currency: order.currency,
            orderedAt: order.orderedAt,
            canceledAt: order.canceledAt ?? null,
            execution: order.execution,
            executionPresence:
                typeof order.execution.filledQuantity !== 'string'
                    ? 'unknown'
                    : /^0+(?:\.0+)?$/.test(order.execution.filledQuantity)
                      ? 'none'
                      : 'present',
        };
        const existing = state.orders.get(order.orderId);
        if (!existing)
            state.orders.set(order.orderId, {
                orderId: order.orderId,
                observations: [reference],
            });
        else if (
            existing.observations.some(
                (entry) => entry.sha256 === reference.sha256
            )
        )
            state.duplicates++;
        else {
            existing.observations.push(reference);
            state.conflicts++;
        }
    }
    if (
        result.hasNext &&
        (result.nextCursor === state.cursor ||
            state.seen.has(result.nextCursor))
    ) {
        state.stalled = true;
    }
    if (state.cursor !== null) state.seen.add(state.cursor);
    state.cursor = result.nextCursor;
    state.complete = !result.hasNext;
}

async function replay(directory, opts) {
    const pages = (await readdir(directory))
        .filter((name) => /^page-\d{8}\.json$/.test(name))
        .sort();
    const state = {
        queryStatus: opts.query.status,
        pages: 0,
        cursor: null,
        seen: new Set(),
        complete: false,
        orders: new Map(),
        duplicates: 0,
        conflicts: 0,
    };
    for (const [index, name] of pages.entries()) {
        if (
            name !== `page-${String(index + 1).padStart(8, '0')}.json` ||
            state.complete ||
            state.stalled
        )
            stop('invalid_archive');
        let receipt;
        try {
            receipt = JSON.parse(await readFile(join(directory, name), 'utf8'));
        } catch {
            stop('invalid_archive');
        }
        ingest(state, receipt, name, opts);
    }
    return state;
}

async function publish(directory, state, reason, includeIndex = true) {
    const summary = {
        format: FORMAT,
        status: state.complete ? 'complete' : 'partial',
        reason: state.complete
            ? state.queryStatus === 'OPEN'
                ? 'open_observation_returned'
                : 'provider_exhausted'
            : reason,
        pages: state.pages,
        uniqueOrders: state.orders.size,
        duplicates: state.duplicates,
        conflicts: state.conflicts,
        coverage:
            state.queryStatus === 'OPEN'
                ? 'supported_open_orders_observed_only'
                : 'supported_closed_orders_observed_only',
        snapshotGuaranteed: false,
        updatedAt: stamp(),
    };
    if (includeIndex)
        await atomicJson(join(directory, 'orders-index.json'), {
            ...summary,
            orders: [...state.orders.values()],
        });
    // A checkpoint is a derived cache. Immutable page receipts are the recovery authority.
    await atomicJson(join(directory, 'checkpoint.json'), {
        ...summary,
        nextCursor: state.cursor,
    });
    return summary;
}

export async function collectOrders(
    input,
    {
        root = resolve('var/toss-orders'),
        fetchImpl = fetch,
        sleep = (ms, signal) => delay(ms, undefined, { signal }),
        signal,
        getToken,
    } = {}
) {
    let directory;
    let lock;
    let state;
    try {
        const opts = optionsFor(input);
        // OPEN is an independent observation with an existing in-memory token only.
        if (opts.query.status === 'OPEN' && getToken) stop('invalid_options');
        if (
            !getToken &&
            (typeof input.token !== 'string' ||
                !input.token.trim() ||
                /[\r\n]/.test(input.token))
        )
            stop('invalid_options');
        directory = join(root, opts.accountHash, opts.run);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        try {
            lock = await open(join(directory, 'writer.lock'), 'wx', 0o600);
        } catch (error) {
            if (error.code === 'EEXIST') stop('locked');
            throw error;
        }
        await lock.writeFile(
            JSON.stringify({ pid: process.pid, startedAt: stamp() })
        );
        const manifestPath = join(directory, 'manifest.json');
        const identity = {
            format: FORMAT,
            accountHash: opts.accountHash,
            query: opts.query,
            source: `${ORIGIN}/api/v1/orders`,
            specification: SPEC,
            specificationVersion: '1.2.24',
        };
        try {
            const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
            if (JSON.stringify(manifest.identity) !== JSON.stringify(identity))
                stop('configuration_mismatch');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            if ((await readdir(directory)).some((name) => /^page-/.test(name)))
                stop('invalid_archive');
            await atomicJson(manifestPath, { identity, startedAt: stamp() });
        }
        state = await replay(directory, opts);
        if (state.stalled) stop('cursor_repeated');
        const reason = 'page_limit';
        const token =
            !state.complete && getToken ? await getToken() : input.token;
        const context = {
            opts,
            accountSeq: input.accountSeq,
            token,
            fetchImpl,
            sleep,
            signal,
            directory,
        };
        for (let count = 0; !state.complete && count < opts.maxPages; count++) {
            const { bytes } = await requestPage(context, state.cursor);
            let raw;
            try {
                raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            } catch {
                stop('invalid_response');
            }
            parsePage(raw, token, opts.query.status);
            const name = `page-${String(state.pages + 1).padStart(8, '0')}.json`;
            const receipt = {
                format: FORMAT,
                accountHash: opts.accountHash,
                cursor: state.cursor,
                receivedAt: stamp(),
                sha256: hash(bytes),
                bodyBase64: bytes.toString('base64'),
            };
            await atomicJson(join(directory, name), receipt);
            ingest(state, receipt, name, opts);
            await publish(
                directory,
                state,
                state.stalled ? 'cursor_repeated' : 'collecting',
                false
            );
            if (state.stalled) stop('cursor_repeated');
        }
        return await publish(directory, state, reason);
    } catch (error) {
        const reason = signal?.aborted
            ? 'interrupted'
            : error instanceof Stop && reasons.has(error.reason)
              ? error.reason
              : 'storage_error';
        // Never turn corrupted/unknown disk state into a successful archive.
        if (state && reason !== 'invalid_archive') {
            try {
                return await publish(directory, state, reason);
            } catch {
                /* Safe summary below. */
            }
        }
        return { status: 'partial', reason, pages: state?.pages ?? 0 };
    } finally {
        if (lock) {
            await lock.close();
            await unlink(join(directory, 'writer.lock')).catch(() => {});
        }
    }
}

export async function collectClosedOrders(input, dependencies) {
    if (input.status !== undefined && input.status !== 'CLOSED')
        return { status: 'partial', reason: 'invalid_options', pages: 0 };
    return collectOrders({ ...input, status: 'CLOSED' }, dependencies);
}

export async function collectOpenOrders(input, dependencies) {
    return collectOrders({ ...input, status: 'OPEN' }, dependencies);
}

const HELP = `Usage: node scripts/toss/collect-closed-orders.mjs --live --run NAME [--status CLOSED|OPEN] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit 100] [--max-pages 10000] [--issue-token]

Reads environment or .env.toss-orders.local at the repository root (no shell expansion).
Default: existing TOSS_ACCESS_TOKEN and TOSS_ACCOUNT_SEQ, GET orders only.
--issue-token: use TOSS_CLIENT_ID / TOSS_CLIENT_SECRET to POST /oauth2/token once.
Issuing a token invalidates this client's previous token. It is never saved or printed.
No account discovery, financial writes or uploads.
OPEN requires an existing token and a separate run beginning with open-.
OPEN sends no limit/cursor, stores all current orders in one response, and never issues tokens.
Output: ignored var/toss-orders/<account hash>/<run>/ (private financial data).
Repeat identical options/run to resume; use a new run for a fresh traversal.
Exit 0: CLOSED pages exhausted or OPEN response recorded; exit 2: partial; exit 1: CLI error.
--live is required for network access. --help performs no I/O or authentication.
See docs/integrations/toss-closed-orders.md for limits and safe operation.`;

export async function loadLocalCredentials(path, environment = process.env) {
    const names = [
        'TOSS_ACCESS_TOKEN',
        'TOSS_ACCOUNT_SEQ',
        'TOSS_CLIENT_ID',
        'TOSS_CLIENT_SECRET',
    ];
    const result = Object.fromEntries(
        names.map((name) => [name, environment[name]])
    );
    let text;
    try {
        text = await readFile(path, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return result;
        throw error;
    }
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line);
        if (!match || !names.includes(match[1])) stop('invalid_options');
        let value = match[2].trim();
        if (value.startsWith('"') || value.startsWith("'")) {
            if (value.at(-1) !== value[0] || value.length < 2)
                stop('invalid_options');
            value = value.slice(1, -1);
        }
        if (!result[match[1]]) result[match[1]] = value;
    }
    return result;
}

// Explicit opt-in only; never retry issuance because it invalidates the previous token.
export async function issueCollectorToken(
    credentials,
    fetchImpl = fetch,
    signal
) {
    if (!credentials.TOSS_CLIENT_ID || !credentials.TOSS_CLIENT_SECRET)
        stop('invalid_options');
    const response = await fetchImpl(`${ORIGIN}/oauth2/token`, {
        method: 'POST',
        redirect: 'error',
        signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: credentials.TOSS_CLIENT_ID,
            client_secret: credentials.TOSS_CLIENT_SECRET,
        }),
    });
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        stop('authentication_failed');
    }
    const bytes = await responseBytes(response);
    let payload;
    try {
        payload = JSON.parse(bytes.toString('utf8'));
    } catch {
        stop('invalid_response');
    }
    if (
        typeof payload.access_token !== 'string' ||
        !payload.access_token ||
        /[\r\n]/.test(payload.access_token)
    )
        stop('invalid_response');
    return payload.access_token;
}

export async function main(args = process.argv.slice(2)) {
    try {
        const { values } = parseArgs({
            args,
            options: {
                help: { type: 'boolean' },
                live: { type: 'boolean' },
                'issue-token': { type: 'boolean' },
                run: { type: 'string' },
                status: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                limit: { type: 'string' },
                'max-pages': { type: 'string' },
            },
        });
        if (values.help) {
            console.log(HELP);
            return 0;
        }
        if (!values.live || !values.run) {
            console.error(
                'Explicit --live and --run are required. Use --help.'
            );
            return 1;
        }
        if (values.status === 'OPEN' && values['issue-token']) {
            console.error(
                'OPEN requires an existing token; token issuance is not supported in this mode.'
            );
            return 1;
        }
        const controller = new AbortController();
        const interrupt = () => controller.abort();
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', interrupt);
        try {
            const repoRoot = resolve(
                dirname(fileURLToPath(import.meta.url)),
                '../..'
            );
            const credentials = await loadLocalCredentials(
                join(repoRoot, '.env.toss-orders.local')
            );
            const input = {
                accountSeq: credentials.TOSS_ACCOUNT_SEQ,
                run: values.run,
                status: values.status ?? 'CLOSED',
                from: values.from ?? null,
                to: values.to ?? null,
                limit: values.limit === undefined ? 100 : Number(values.limit),
                maxPages:
                    values['max-pages'] === undefined
                        ? 10000
                        : Number(values['max-pages']),
            };
            optionsFor(input); // Validate before any token issuance.
            const result = await collectOrders(
                { ...input, token: credentials.TOSS_ACCESS_TOKEN },
                {
                    root: join(repoRoot, 'var/toss-orders'),
                    signal: controller.signal,
                    getToken: values['issue-token']
                        ? () =>
                              issueCollectorToken(
                                  credentials,
                                  fetch,
                                  controller.signal
                              )
                        : undefined,
                }
            );
            console.log(JSON.stringify(result));
            return result.status === 'complete' ? 0 : 2;
        } finally {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', interrupt);
        }
    } catch {
        console.error('Invalid command or local I/O failure. Use --help.');
        return 1;
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    process.exitCode = await main();
