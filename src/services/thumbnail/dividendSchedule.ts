import Holidays from 'date-holidays';
import { normalizeFrequency } from './frequency';
import { partitionScheduleHistory } from './scheduleVerification';
import { getAssetUrl } from '@/utils/dataUrl';
import {
    isDataReleaseConfigured,
    loadDataReleaseHistory,
    loadDataReleaseIndex,
} from '@/services/dataRelease';

export type DividendScheduleEvent = {
    id?: number;
    ticker: string;
    declaredDate?: string | null;
    exDate: string;
    recordDate?: string | null;
    payableDate?: string | null;
    frequency?: string | null;
    verificationStatus?: string | null;
    officialUrl?: string | null;
    amount?: string | number | null;
};

export type CalendarMarker = {
    date: string;
    kind: 'ex' | 'record' | 'payable' | 'deposit' | 'forecast';
    status: 'confirmed' | 'completed' | 'forecast';
};

export type DividendSchedule = {
    ticker: string;
    frequency: string | null;
    current: DividendScheduleEvent | null;
    markers: CalendarMarker[];
    forecastExDate: string | null;
    depositRange: { start: string; end: string } | null;
    intervalDays: number | null;
    history: DividendScheduleEvent[];
    reviewHistory: DividendScheduleEvent[];
};

type LedgerEvent = {
    id?: number;
    ticker: string;
    declared_date?: string | null;
    ex_date?: string | null;
    record_date?: string | null;
    payable_date?: string | null;
    frequency?: string | null;
    verification_status?: string | null;
    official_url?: string | null;
    distribution_per_share?: string | number | null;
};

const iso = (value: unknown) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : null;
const toEvent = (row: LedgerEvent): DividendScheduleEvent | null => {
    const exDate = iso(row.ex_date);
    if (!exDate) return null;
    return {
        id: row.id,
        ticker: row.ticker,
        declaredDate: iso(row.declared_date),
        exDate,
        recordDate: iso(row.record_date),
        payableDate: iso(row.payable_date),
        frequency: normalizeFrequency(row.frequency),
        verificationStatus: row.verification_status ?? null,
        officialUrl: row.official_url ?? null,
        amount: row.distribution_per_share ?? null,
    };
};

const day = (value: string) => new Date(`${value}T12:00:00`);
const format = (value: Date) => value.toISOString().slice(0, 10);
const today = () => format(new Date());

const koreanHolidays = new Holidays('KR');
const isKoreanBusinessDay = (value: Date) => {
    const weekday = value.getDay();
    return weekday !== 0 && weekday !== 6 && !koreanHolidays.isHoliday(value);
};
const addKoreanBusinessDays = (start: string, count: number) => {
    const value = day(start);
    let remaining = count;
    while (remaining > 0) {
        value.setDate(value.getDate() + 1);
        if (isKoreanBusinessDay(value)) remaining -= 1;
    }
    return format(value);
};

const expectedIntervalDays = (events: DividendScheduleEvent[]) => {
    const dates = events.slice(0, 4).map((event) => event.exDate).sort();
    if (dates.length < 2) return null;
    const gaps = dates.slice(1).map((date, index) =>
        Math.round((day(date).getTime() - day(dates[index]).getTime()) / 86400000)
    );
    return Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
};

async function loadHistory(ticker: string): Promise<DividendScheduleEvent[]> {
    if (isDataReleaseConfigured()) {
        const index = await loadDataReleaseIndex();
        const row = index.tickers.find((item: { ticker: string }) => item.ticker.toUpperCase() === ticker);
        if (!row) return [];
        const history = await loadDataReleaseHistory(row.historyUrl);
        return history.history.map(toEvent).filter(Boolean) as DividendScheduleEvent[];
    }
    const indexResponse = await fetch(getAssetUrl('content-studio/distribution-index.json'), { cache: 'no-store' });
    if (!indexResponse.ok) return [];
    const index = await indexResponse.json();
    const row = (index.tickers ?? []).find((item: { ticker?: string }) => item.ticker?.toUpperCase() === ticker);
    if (!row?.historyUrl) return [];
    const historyResponse = await fetch(getAssetUrl(String(row.historyUrl).replace(/^\//, '')), { cache: 'no-store' });
    if (!historyResponse.ok) return [];
    const history = await historyResponse.json();
    return (history.history ?? []).map(toEvent).filter(Boolean) as DividendScheduleEvent[];
}

export async function loadDividendSchedule(ticker: string, fallbackFrequency?: string | null): Promise<DividendSchedule> {
    const { confirmed: events, review: reviewHistory } = partitionScheduleHistory(await loadHistory(ticker.toUpperCase()));
    const reference = today();
    const announcedNext = events.find((event) => event.exDate >= reference) ?? null;
    const current = announcedNext ?? events[0] ?? null;
    const frequency = current?.frequency ?? events[0]?.frequency ?? normalizeFrequency(fallbackFrequency) ?? reviewHistory[0]?.frequency ?? null;
    const isWeekly = frequency === 'weekly';
    const displayedEvents = events.filter((event) =>
        isWeekly
            ? event.exDate >= format(new Date(day(reference).getTime() - 42 * 86400000))
            : event.exDate.slice(0, 4) === reference.slice(0, 4)
    );
    const markers: CalendarMarker[] = displayedEvents
        .flatMap((event) => {
            const status: CalendarMarker['status'] = event.exDate < reference ? 'completed' : 'confirmed';
            return [
                { date: event.exDate, kind: 'ex' as const, status },
                ...(event.recordDate ? [{ date: event.recordDate, kind: 'record' as const, status }] : []),
                ...(event.payableDate ? [{ date: event.payableDate, kind: 'payable' as const, status }] : []),
            ];
        });
    const interval = expectedIntervalDays(events);
    const forecastExDate = announcedNext || !events[0] || !interval
        ? null
        : format(new Date(day(events[0].exDate).getTime() + interval * 86400000));
    if (forecastExDate && forecastExDate > reference) markers.push({ date: forecastExDate, kind: 'forecast', status: 'forecast' });
    const depositRange = current?.payableDate
        ? { start: addKoreanBusinessDays(current.payableDate, 1), end: addKoreanBusinessDays(current.payableDate, 2) }
        : null;
    if (depositRange) markers.push({ date: depositRange.start, kind: 'deposit', status: 'confirmed' });
    return { ticker: ticker.toUpperCase(), frequency, current, markers, forecastExDate, depositRange, intervalDays: interval, history: events, reviewHistory };
}
