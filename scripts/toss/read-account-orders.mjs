#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
    prepareManualPublication,
    publishExisting,
    createExistingR2Transport,
} from './publish-account-observations.mjs';
import {
    collectOrders,
    issueCollectorToken,
    loadLocalCredentials,
} from './collect-closed-orders.mjs';

const ORIGIN = 'https://openapi.tossinvest.com';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HELP = `Manual read only: node scripts/toss/read-account-orders.mjs --live --account-suffix FOUR_DIGITS --status OPEN|CLOSED|BOTH [--from YYYY-MM-DD --to YYYY-MM-DD | --all-history] [--env-file EXISTING_FILE] [--issue-token]
OPEN reads all current supported orders, without date filters.
CLOSED/BOTH require a date range or explicit --all-history.
Each invocation creates fresh unique runs; completed archives are never reused.
Existing TOSS_ACCESS_TOKEN is preferred. --issue-token permits one token issuance only if no token exists; issuance invalidates the previous token for this client.
Credentials come from the existing file or environment, never from command arguments.
No scheduling, financial writes, browser control, uploads, or automatic reauthentication.
Private observations: var/toss-orders/ (Git ignored). Exit 0: requested API scopes complete; 2: partial/authentication required; 1: invalid command.
Browser dividend details are a separate skill step; API completion does not verify them.`;
const PUBLICATION_HELP = `Optional authorized persistence: --prepare-publication --ledger-account wife [--browser-observation EXISTING_EGO_JSON], or --publish --ledger-account wife [--browser-observation EXISTING_EGO_JSON].
--prepare-publication writes an offline verified local plan only. --publish requires existing R2 environment credentials and performs immutable uploads, GET/member verification and an append-only index commit. API success and publication success remain separate.
To resume publication without recollecting: node scripts/toss/publish-account-observations.mjs --directory EXISTING_PUBLICATION --publish.
If credentials are unavailable, use the existing authorized Cloudflare connector with the prepared immutable plan; do not create/copy credentials or report the plan as linked.`;

function validDate(value) {
    return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}
export function validateManualOptions(options) {
    const status = options.status ?? 'BOTH';
    if (
        !['OPEN', 'CLOSED', 'BOTH'].includes(status) ||
        !/^\d{4}$/.test(options.accountSuffix ?? '')
    )
        return false;
    if (status === 'OPEN')
        return !options.from && !options.to && !options.allHistory;
    if (options.allHistory) return !options.from && !options.to;
    return (
        validDate(options.from) &&
        validDate(options.to) &&
        options.from <= options.to
    );
}

export async function readAccountOrders(
    options,
    {
        credentials = {},
        fetchImpl = fetch,
        sleep,
        root = resolve(repoRoot, 'var/toss-orders'),
        now = () => new Date().toISOString(),
        uniqueId = randomUUID,
        signal,
    } = {}
) {
    const result = {
        schema: 'toss-manual-orders/v1',
        apiStatus: 'not_attempted',
        browserStatus: 'not_run',
        scopes: {},
        requests: { token: 0, accounts: 0, orders: 0 },
    };
    if (!validateManualOptions(options))
        return { ...result, reason: 'invalid_scope_or_account_selection' };
    const selected = options.status ?? 'BOTH';
    for (const status of ['OPEN', 'CLOSED'])
        result.scopes[status] = {
            status:
                selected === 'BOTH' || selected === status
                    ? 'not_attempted'
                    : 'not_requested',
        };
    let token = credentials.TOSS_ACCESS_TOKEN;
    const transport = async (url, request) => {
        const parsed = new URL(url);
        if (parsed.origin !== ORIGIN) throw new Error('origin_rejected');
        if (parsed.pathname === '/oauth2/token' && request.method === 'POST')
            result.requests.token++;
        else if (
            parsed.pathname === '/api/v1/accounts' &&
            request.method === 'GET'
        )
            result.requests.accounts++;
        else if (
            parsed.pathname === '/api/v1/orders' &&
            request.method === 'GET'
        )
            result.requests.orders++;
        else throw new Error('endpoint_rejected');
        return fetchImpl(url, request);
    };
    try {
        if (!token) {
            if (
                !options.issueToken ||
                !credentials.TOSS_CLIENT_ID ||
                !credentials.TOSS_CLIENT_SECRET
            )
                return { ...result, reason: 'authentication_required' };
            token = await issueCollectorToken(credentials, transport, signal);
        }
        const accountsResponse = await transport(`${ORIGIN}/api/v1/accounts`, {
            method: 'GET',
            redirect: 'error',
            signal: signal
                ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
                : AbortSignal.timeout(30000),
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
        });
        if (!accountsResponse.ok) {
            await accountsResponse.body?.cancel().catch(() => {});
            return {
                ...result,
                apiStatus: 'partial',
                reason: [401, 403].includes(accountsResponse.status)
                    ? 'authentication_failed'
                    : 'account_lookup_failed',
                httpStatus: accountsResponse.status,
            };
        }
        const payload = await accountsResponse.json();
        if (!Array.isArray(payload?.result) || payload.error)
            return {
                ...result,
                apiStatus: 'partial',
                reason: 'account_response_invalid',
            };
        const matches = payload.result.filter(
            (account) =>
                typeof account.accountNo === 'string' &&
                account.accountNo.endsWith(options.accountSuffix) &&
                account.accountType === 'BROKERAGE' &&
                Number.isSafeInteger(account.accountSeq) &&
                account.accountSeq > 0
        );
        if (matches.length !== 1)
            return {
                ...result,
                apiStatus: 'partial',
                reason: 'account_selection_not_unique',
                matchingAccounts: matches.length,
            };
        const accountSeq = String(matches[0].accountSeq);
        result.accountMasked = `****${options.accountSuffix}`;
        result.invocationId = `manual-${now().replace(/[-:.]/g, '')}-${uniqueId().slice(0, 8)}`;
        for (const status of ['OPEN', 'CLOSED']) {
            if (result.scopes[status].status === 'not_requested') continue;
            const run = `${status === 'OPEN' ? 'open' : 'closed'}-${result.invocationId}`;
            const scope = await collectOrders(
                {
                    accountSeq,
                    token,
                    status,
                    run,
                    maxRetries: 0,
                    from: status === 'CLOSED' ? (options.from ?? null) : null,
                    to: status === 'CLOSED' ? (options.to ?? null) : null,
                },
                {
                    root,
                    fetchImpl: transport,
                    signal,
                    ...(sleep ? { sleep } : {}),
                }
            );
            result.scopes[status] = { ...scope, run };
            if (scope.status !== 'complete')
                return {
                    ...result,
                    apiStatus: 'partial',
                    reason: scope.reason,
                };
        }
        const completed = {
            ...result,
            apiStatus: 'complete',
            checkedAt: now(),
            scopeLimit:
                'supported_orders_only_not_individual_fills_cash_or_dividend_deposits',
        };
        if (options.preparePublication || options.publish) {
            if (options.ledgerAccount !== 'wife')
                return {
                    ...completed,
                    publication: {
                        status: 'not_linked',
                        reason: 'explicit_ledger_account_required',
                    },
                };
            try {
                const plan = await prepareManualPublication({
                    root,
                    accountSeq,
                    accountSuffix: options.accountSuffix,
                    scopes: result.scopes,
                    browserFile: options.browserFile,
                    checkedAt: completed.checkedAt,
                });
                completed.publication = options.publish
                    ? await publishExisting({
                          directory: plan.localDirectory,
                          ...(await createExistingR2Transport()),
                      })
                    : plan;
            } catch {
                completed.publication = {
                    status: 'not_linked',
                    reason: 'publication_failed_local_evidence_preserved',
                };
            }
        }
        return completed;
    } catch (error) {
        const reason = signal?.aborted
            ? 'interrupted'
            : [
                    'authentication_failed',
                    'invalid_response',
                    'invalid_options',
                ].includes(error?.message)
              ? error.message
              : 'request_or_local_io_failed';
        return { ...result, apiStatus: 'partial', reason };
    } finally {
        token = undefined;
    }
}

export async function main(args = process.argv.slice(2)) {
    try {
        const { values } = parseArgs({
            args,
            options: {
                help: { type: 'boolean' },
                live: { type: 'boolean' },
                'account-suffix': { type: 'string' },
                status: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                'all-history': { type: 'boolean' },
                'env-file': { type: 'string' },
                'issue-token': { type: 'boolean' },
                'prepare-publication': { type: 'boolean' },
                publish: { type: 'boolean' },
                'ledger-account': { type: 'string' },
                'browser-observation': { type: 'string' },
            },
        });
        if (values.help) {
            console.log(HELP);
            console.log(PUBLICATION_HELP);
            return 0;
        }
        const options = {
            accountSuffix: values['account-suffix'],
            status: values.status ?? 'BOTH',
            from: values.from,
            to: values.to,
            allHistory: values['all-history'] ?? false,
            issueToken: values['issue-token'] ?? false,
            preparePublication: values['prepare-publication'] ?? false,
            publish: values.publish ?? false,
            ledgerAccount: values['ledger-account'],
            browserFile: values['browser-observation'],
        };
        if (
            !values.live ||
            !validateManualOptions(options) ||
            ((options.publish || options.preparePublication) &&
                options.ledgerAccount !== 'wife') ||
            (options.browserFile &&
                !options.publish &&
                !options.preparePublication)
        ) {
            console.error(
                'Specify --live, selected account suffix and an explicit supported scope. Use --help.'
            );
            return 1;
        }
        const credentials = await loadLocalCredentials(
            values['env-file']
                ? resolve(values['env-file'])
                : resolve(repoRoot, '.env.toss-orders.local')
        );
        const controller = new AbortController();
        const interrupt = () => controller.abort();
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', interrupt);
        try {
            const result = await readAccountOrders(options, {
                credentials,
                signal: controller.signal,
            });
            console.log(JSON.stringify(result));
            return result.apiStatus === 'complete' &&
                (!options.publish || result.publication?.status === 'linked') &&
                (!options.preparePublication ||
                    !['not_linked'].includes(result.publication?.status))
                ? 0
                : 2;
        } finally {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', interrupt);
        }
    } catch {
        console.error(
            'Invalid command or local configuration; no values were emitted. Use --help.'
        );
        return 1;
    }
}
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    process.exitCode = await main();
