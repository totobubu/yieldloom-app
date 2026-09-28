import { computed, ref } from 'vue';

export type DistributionEvent = {
    distribution_per_share: string;
    ex_date: string;
    payable_date: string | null;
    frequency?: string;
    verification_status: string;
    official_url: string;
    previous_amount: string | null;
    average4: number | null;
    average12: number | null;
    comparisonBasis?: string;
};
export type DistributionTicker = {
    ticker: string;
    providerSlug: string;
    latest: DistributionEvent;
    historyUrl: string;
    historyCount: number;
};
export type Holding = {
    ticker: string;
    shares: number;
    savedAt: string;
    source: 'manual' | 'toss';
};
export type TossSnapshot = {
    source: 'toss';
    accountSeq: number;
    syncedAt: string;
    holdings: Array<{
        ticker: string;
        shares: number;
        market: 'KR' | 'US' | null;
        name: string | null;
    }>;
};
type PersistedPortfolio = {
    version: 2;
    holdings: Holding[];
    watchlist: string[];
    tossSnapshot: TossSnapshot | null;
};

const storageKey = 'divgrow.dividend-portfolio.v1';
const blank = (): PersistedPortfolio => ({
    version: 2,
    holdings: [],
    watchlist: [],
    tossSnapshot: null,
});
const state = ref<PersistedPortfolio>(blank());
let loaded = false;

function persist() {
    if (typeof window !== 'undefined')
        localStorage.setItem(storageKey, JSON.stringify(state.value));
}
function load() {
    if (loaded || typeof window === 'undefined') return;
    loaded = true;
    try {
        const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (
            ![1, 2].includes(value?.version) ||
            !Array.isArray(value.holdings) ||
            !Array.isArray(value.watchlist)
        )
            throw new Error('invalid');
        state.value = {
            version: 2,
            holdings: value.holdings
                .filter(
                    (item: Holding) =>
                        typeof item?.ticker === 'string' &&
                        Number.isFinite(item.shares) &&
                        item.shares > 0
                )
                .map((item: Holding) => ({
                    ticker: item.ticker.toUpperCase(),
                    shares: item.shares,
                    savedAt: item.savedAt || new Date().toISOString(),
                    source: item.source === 'toss' ? 'toss' : 'manual',
                })),
            watchlist: value.watchlist
                .filter((ticker: unknown) => typeof ticker === 'string')
                .map((ticker: string) => ticker.toUpperCase()),
            tossSnapshot:
                value?.tossSnapshot?.source === 'toss' &&
                Number.isSafeInteger(value.tossSnapshot.accountSeq) &&
                typeof value.tossSnapshot.syncedAt === 'string' &&
                Array.isArray(value.tossSnapshot.holdings)
                    ? value.tossSnapshot
                    : null,
        };
    } catch {
        state.value = blank();
        persist();
    }
}

export function annualized(event: DistributionEvent) {
    if (event.comparisonBasis === 'corporate_action_or_frequency_change')
        return null;
    const amount = Number(event.distribution_per_share);
    if (!Number.isFinite(amount)) return null;
    const multiplier =
        event.frequency === 'weekly'
            ? 52
            : event.frequency === 'monthly'
              ? 12
              : event.frequency === 'quarterly'
                ? 4
                : event.frequency === 'semiannual'
                  ? 2
                  : event.frequency === 'annual'
                    ? 1
                    : null;
    return multiplier ? amount * multiplier : null;
}
export function distributionCadenceDays(event: DistributionEvent) {
    return event.frequency === 'weekly'
        ? 7
        : event.frequency === 'monthly'
          ? 30
          : event.frequency === 'quarterly'
            ? 91
            : event.frequency === 'semiannual'
              ? 182
              : event.frequency === 'annual'
                ? 365
                : null;
}
export function nextExpectedDate(event: DistributionEvent) {
    if (event.comparisonBasis === 'corporate_action_or_frequency_change')
        return null;
    const date = new Date(`${event.ex_date}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    const days = distributionCadenceDays(event);
    if (!days) return null;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    do date.setUTCDate(date.getUTCDate() + days);
    while (date <= today);
    return date.toISOString().slice(0, 10);
}

export function useDividendPortfolio() {
    load();
    const holdings = computed(() => state.value.holdings);
    const watchlist = computed(() => state.value.watchlist);
    const tossSnapshot = computed(() => state.value.tossSnapshot);
    const setHolding = (ticker: string, shares: number) => {
        const normalized = ticker.toUpperCase();
        const next = Number(shares);
        state.value.holdings = state.value.holdings.filter(
            (item) => item.ticker !== normalized
        );
        if (Number.isFinite(next) && next > 0)
            state.value.holdings.push({
                ticker: normalized,
                shares: next,
                savedAt: new Date().toISOString(),
                source: 'manual',
            });
        persist();
    };
    const removeHolding = (ticker: string) => {
        state.value.holdings = state.value.holdings.filter(
            (item) => item.ticker !== ticker
        );
        persist();
    };
    const toggleWatchlist = (ticker: string) => {
        const normalized = ticker.toUpperCase();
        state.value.watchlist = state.value.watchlist.includes(normalized)
            ? state.value.watchlist.filter((item) => item !== normalized)
            : [...state.value.watchlist, normalized];
        persist();
    };
    const saveTossSnapshot = (snapshot: TossSnapshot) => {
        state.value.tossSnapshot = snapshot;
        persist();
    };
    const applyTossSnapshot = () => {
        const snapshot = state.value.tossSnapshot;
        if (!snapshot) return;
        const tossTickers = new Set(
            snapshot.holdings.map((item) => item.ticker.toUpperCase())
        );
        const manualUnmatched = state.value.holdings.filter(
            (item) => item.source !== 'toss' && !tossTickers.has(item.ticker)
        );
        state.value.holdings = [
            ...manualUnmatched,
            ...snapshot.holdings.map((item) => ({
                ticker: item.ticker.toUpperCase(),
                shares: item.shares,
                savedAt: snapshot.syncedAt,
                source: 'toss' as const,
            })),
        ];
        persist();
    };
    return {
        holdings,
        watchlist,
        tossSnapshot,
        setHolding,
        removeHolding,
        toggleWatchlist,
        saveTossSnapshot,
        applyTossSnapshot,
    };
}
