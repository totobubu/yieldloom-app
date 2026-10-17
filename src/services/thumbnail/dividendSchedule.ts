import Holidays from 'date-holidays';
import { readPublicJson } from '../publicJson.js';
import { normalizeFrequency } from './frequency';
import {
    currentScheduleEvent,
    partitionScheduleHistory,
} from './scheduleVerification';
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
    currency?: string | null;
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
    currency?: string | null;
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
        currency: row.currency ?? null,
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
    const dates = events
        .slice(0, 4)
        .map((event) => event.exDate)
        .sort();
    if (dates.length < 2) return null;
    const gaps = dates
        .slice(1)
        .map((date, index) =>
            Math.round(
                (day(date).getTime() - day(dates[index]).getTime()) / 86400000
            )
        );
    return Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
};

type ScheduleOptions = { signal?: AbortSignal; force?: boolean };
async function loadScheduleIndex(options: ScheduleOptions = {}) {
    if (isDataReleaseConfigured()) return loadDataReleaseIndex(options);
    return readPublicJson(
        getAssetUrl('content-studio/distribution-index.json'),
        {
            ...options,
            ttlMs: 180_000,
            validate: (payload: { tickers?: unknown }) =>
                Array.isArray(payload?.tickers),
        }
    );
}
async function loadScheduleHistory(url: string, options: ScheduleOptions = {}) {
    const raw = isDataReleaseConfigured()
        ? await loadDataReleaseHistory(url, options)
        : await readPublicJson(getAssetUrl(url.replace(/^\//, '')), {
              ...options,
              ttlMs: 180_000,
              validate: (payload: { history?: unknown }) =>
                  Array.isArray(payload?.history),
          });
    return raw.history.map(toEvent).filter(Boolean) as DividendScheduleEvent[];
}
export async function loadDividendSchedule(
    ticker: string,
    fallbackFrequency?: string | null,
    options: ScheduleOptions = {}
): Promise<DividendSchedule> {
    const index = await loadScheduleIndex(options);
    const row = index.tickers.find(
        (item: { ticker: string }) =>
            item.ticker.toUpperCase() === ticker.toUpperCase()
    );
    const history = row
        ? await loadScheduleHistory(row.historyUrl, options)
        : [];
    return buildSchedule(ticker, history, fallbackFrequency);
}

function buildSchedule(
    ticker: string,
    history: DividendScheduleEvent[],
    fallbackFrequency?: string | null
): DividendSchedule {
    const { confirmed: events, review: reviewHistory } =
        partitionScheduleHistory(history);
    const reference = today();
    const current = currentScheduleEvent(events, reference);
    const announcedNext =
        current && current.exDate >= reference ? current : null;
    const frequency =
        current?.frequency ??
        events[0]?.frequency ??
        normalizeFrequency(fallbackFrequency) ??
        reviewHistory[0]?.frequency ??
        null;
    const isWeekly = frequency === 'weekly';
    const displayedEvents = events.filter((event) =>
        isWeekly
            ? event.exDate >=
              format(new Date(day(reference).getTime() - 42 * 86400000))
            : event.exDate.slice(0, 4) === reference.slice(0, 4)
    );
    const markers: CalendarMarker[] = displayedEvents.flatMap((event) => {
        const status: CalendarMarker['status'] =
            event.exDate < reference ? 'completed' : 'confirmed';
        return [
            { date: event.exDate, kind: 'ex' as const, status },
            ...(event.recordDate
                ? [{ date: event.recordDate, kind: 'record' as const, status }]
                : []),
            ...(event.payableDate
                ? [
                      {
                          date: event.payableDate,
                          kind: 'payable' as const,
                          status,
                      },
                  ]
                : []),
        ];
    });
    const interval = expectedIntervalDays(events);
    const forecastExDate =
        announcedNext || !events[0] || !interval
            ? null
            : format(
                  new Date(
                      day(events[0].exDate).getTime() + interval * 86400000
                  )
              );
    if (forecastExDate && forecastExDate > reference)
        markers.push({
            date: forecastExDate,
            kind: 'forecast',
            status: 'forecast',
        });
    const depositRange = current?.payableDate
        ? {
              start: addKoreanBusinessDays(current.payableDate, 1),
              end: addKoreanBusinessDays(current.payableDate, 2),
          }
        : null;
    if (depositRange)
        markers.push({
            date: depositRange.start,
            kind: 'deposit',
            status: 'confirmed',
        });
    return {
        ticker: ticker.toUpperCase(),
        frequency,
        current,
        markers,
        forecastExDate,
        depositRange,
        intervalDays: interval,
        history: events,
        reviewHistory,
    };
}

// Public raw history is shared with search and ticker detail by URL in publicJson.
export async function loadPortfolioSchedules(
    tickers: string[],
    signal?: AbortSignal,
    force = false
) {
    const schedules: Record<string, DividendSchedule> = {},
        errors: Record<string, string> = {};
    const all = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))];
    const selected = all.slice(0, 100);
    all.slice(100).forEach(
        (ticker) =>
            (errors[ticker] =
                '한 번에 100개 종목까지 조회합니다. 계좌 필터로 나누어 주세요.')
    );
    let index;
    try {
        index = selected.length
            ? await loadScheduleIndex({ signal, force })
            : { tickers: [] };
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error('배당 일정 목록을 불러오지 못했습니다.');
    }
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, selected.length) }, async () => {
            while (cursor < selected.length) {
                const ticker = selected[cursor++];
                if (signal?.aborted)
                    throw new DOMException(
                        '조회를 취소했습니다.',
                        'AbortError'
                    );
                try {
                    const row = index.tickers.find(
                        (row: { ticker: string }) =>
                            row.ticker.toUpperCase() === ticker
                    );
                    if (!row) {
                        errors[ticker] =
                            '공식 배당 일정의 지원 종목이 아닙니다.';
                        continue;
                    }
                    const history = await loadScheduleHistory(row.historyUrl, {
                        signal,
                        force,
                    });
                    schedules[ticker] = buildSchedule(ticker, history);
                    if (
                        !schedules[ticker].history.length &&
                        !schedules[ticker].reviewHistory.length
                    )
                        errors[ticker] = '확인 가능한 공시 일정이 없습니다.';
                } catch (reason) {
                    if (signal?.aborted) throw reason;
                    errors[ticker] =
                        reason instanceof Error
                            ? reason.message
                            : '일정 조회에 실패했습니다.';
                }
            }
        })
    );
    return { schedules, errors };
}
