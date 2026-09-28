export type TossAccount = {
    accountSeq: number;
    accountType: string;
    label: string;
};
export type TossHolding = {
    ticker: string;
    shares: number;
    market: 'KR' | 'US' | null;
    name: string | null;
};
export type TossSnapshot = {
    source: 'toss';
    accountSeq: number;
    syncedAt: string;
    holdings: TossHolding[];
};

async function request<T>(query: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams(query);
    const response = await fetch(
        `/api/toss-portfolio${params.size ? `?${params}` : ''}`,
        { cache: 'no-store' }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(
            payload.error || 'Toss 보유수량을 불러오지 못했습니다.'
        );
    return payload as T;
}

export async function getTossAccounts() {
    return request<{ accounts: TossAccount[] }>({ action: 'accounts' });
}

export async function getTossSnapshot(accountSeq: number) {
    return request<TossSnapshot>({
        action: 'holdings',
        accountSeq: String(accountSeq),
    });
}
