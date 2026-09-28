const TOSS_API_ORIGIN = 'https://openapi.tossinvest.com';

export class TossPortfolioError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.status = status;
    }
}

function configured() {
    return Boolean(
        process.env.TOSS_CLIENT_ID && process.env.TOSS_CLIENT_SECRET
    );
}

async function providerFetch(path, options, fetchImpl = fetch) {
    const response = await fetchImpl(`${TOSS_API_ORIGIN}${path}`, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message =
            body?.error?.message ||
            body?.error_description ||
            '토스증권 요청을 완료하지 못했습니다.';
        throw new TossPortfolioError(
            message,
            response.status === 401 || response.status === 403
                ? 503
                : response.status
        );
    }
    return body;
}

export async function issueAccessToken(fetchImpl = fetch) {
    if (!configured())
        throw new TossPortfolioError(
            'Toss 읽기 전용 연동이 아직 설정되지 않았습니다.',
            503
        );
    const form = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.TOSS_CLIENT_ID,
        client_secret: process.env.TOSS_CLIENT_SECRET,
    });
    const response = await fetchImpl(`${TOSS_API_ORIGIN}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
        throw new TossPortfolioError(
            payload.error_description ||
                'Toss 액세스 토큰을 발급하지 못했습니다.',
            503
        );
    }
    return payload.access_token;
}

function apiHeaders(token, accountSeq) {
    return {
        Authorization: `Bearer ${token}`,
        ...(accountSeq === undefined
            ? {}
            : { 'X-Tossinvest-Account': String(accountSeq) }),
    };
}

export function normalizeAccounts(payload) {
    const accounts = Array.isArray(payload?.result) ? payload.result : [];
    return accounts
        .filter(
            (item) =>
                Number.isSafeInteger(item?.accountSeq) && item.accountSeq > 0
        )
        .map((item) => ({
            accountSeq: item.accountSeq,
            accountType: String(item.accountType || 'BROKERAGE'),
            label: `${item.accountType || 'BROKERAGE'} #${String(item.accountNo || '').slice(-4) || item.accountSeq}`,
        }));
}

export function normalizeHoldings(
    payload,
    accountSeq,
    syncedAt = new Date().toISOString()
) {
    const items = Array.isArray(payload?.result?.items)
        ? payload.result.items
        : [];
    return {
        source: 'toss',
        accountSeq,
        syncedAt,
        holdings: items
            .filter(
                (item) =>
                    typeof item?.symbol === 'string' &&
                    Number.isFinite(Number(item.quantity))
            )
            .map((item) => ({
                ticker: item.symbol.toUpperCase(),
                shares: Number(item.quantity),
                market:
                    item.marketCountry === 'US' || item.marketCountry === 'KR'
                        ? item.marketCountry
                        : null,
                name: typeof item.name === 'string' ? item.name : null,
            }))
            .filter((item) => item.shares > 0),
    };
}

export async function listAccounts(fetchImpl = fetch) {
    const token = await issueAccessToken(fetchImpl);
    const payload = await providerFetch(
        '/api/v1/accounts',
        { headers: apiHeaders(token) },
        fetchImpl
    );
    return { accounts: normalizeAccounts(payload) };
}

export async function fetchHoldings(accountSeq, fetchImpl = fetch) {
    if (!Number.isSafeInteger(accountSeq) || accountSeq <= 0) {
        throw new TossPortfolioError('유효한 Toss 계좌를 선택하세요.', 400);
    }
    const token = await issueAccessToken(fetchImpl);
    const payload = await providerFetch(
        '/api/v1/holdings',
        { headers: apiHeaders(token, accountSeq) },
        fetchImpl
    );
    return normalizeHoldings(payload, accountSeq);
}
