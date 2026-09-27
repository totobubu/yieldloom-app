// scripts/detect_event_changes.js
//
// 배당 내역과 시세 데이터에서 배당 주기 변화 및 주식 분할/병합 이벤트를
// 자동으로 감지하여 보고서를 생성합니다.
//
// 기본적으로 전체 종목을 스캔하지만, CLI 옵션으로 범위를 좁힐 수 있습니다.
//   --symbol=ULTY,AMZY      특정 심볼(콤마 구분)만 분석
//   --company=YieldMax      nav.json 내 company 기준으로 필터링
//   --output=경로           보고서 저장 경로 지정 (기본: scripts/output/events-report.json)
//
// 실행 예시:
//   node scripts/detect_event_changes.js --company=YieldMax
//
// 보고서는 JSON 형태로 생성되며, 각 종목별로 감지된 주기 세그먼트,
// 변경 이벤트, 분할/병합 기록을 포함합니다. 실제 데이터 반영은
// add_event_metadata.js 또는 별도 워크플로우에서 수행하세요.

import fs from 'fs/promises';
import path from 'path';

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data');
const NAV_PATH = path.join(ROOT_DIR, 'public', 'nav.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'scripts', 'output');
const DEFAULT_OUTPUT = path.join(OUTPUT_DIR, 'events-report.json');
const DEFAULT_CONFIG_TEMPLATE = path.join(
    OUTPUT_DIR,
    'events-config-template.json'
);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
        return [key, value];
    })
);

const requestedSymbols = args.symbol
    ? args.symbol
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
    : null;
const requestedCompany = args.company || null;
const outputPath = args.output ? path.resolve(args.output) : DEFAULT_OUTPUT;
const templatePath = args.template
    ? path.resolve(args.template)
    : DEFAULT_CONFIG_TEMPLATE;

async function loadNav() {
    const raw = await fs.readFile(NAV_PATH, 'utf8');
    const json = JSON.parse(raw);
    return json.nav || [];
}

function toDate(dateStr) {
    return new Date(dateStr);
}

function diffInDays(prev, next) {
    return Math.round((next - prev) / DAY_MS);
}

function classifyInterval(days) {
    if (!Number.isFinite(days) || days <= 0) {
        return { label: '불명', perYear: null };
    }

    const rules = [
        { max: 10, label: '매주', perYear: 52 },
        { max: 20, label: '격주', perYear: 26 },
        { max: 36, label: '4주', perYear: 13 },
        { max: 55, label: '매월', perYear: 12 },
        { max: 110, label: '분기', perYear: 4 },
        { max: 190, label: '반기', perYear: 2 },
        { max: 400, label: '매년', perYear: 1 },
    ];

    const matched = rules.find((rule) => days <= rule.max);
    if (matched) return matched;

    return { label: '장기', perYear: null };
}

const parseIsoDateUTC = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
};

function buildSegments(events) {
    if (events.length < 2) return [];

    const intervals = [];
    const rawSegments = [];
    for (let i = 1; i < events.length; i += 1) {
        const prev = toDate(events[i - 1].date);
        const next = toDate(events[i].date);
        intervals.push({
            index: i,
            days: diffInDays(prev, next),
        });
    }

    let current = null;

    for (const interval of intervals) {
        const classification = classifyInterval(interval.days);
        if (!current) {
            current = {
                startIndex: interval.index - 1,
                endIndex: interval.index,
                intervals: [interval.days],
                classification,
            };
            continue;
        }

        if (classification.label === current.classification.label) {
            current.endIndex = interval.index;
            current.intervals.push(interval.days);
        } else {
            rawSegments.push(current);
            current = {
                startIndex: interval.index - 1,
                endIndex: interval.index,
                intervals: [interval.days],
                classification,
            };
        }
    }

    if (current) rawSegments.push(current);

    const MIN_SEGMENT_INTERVALS = 3;

    return rawSegments.map((segment) => {
        const { startIndex, endIndex, intervals, classification } = segment;
        const startEvent = events[startIndex];
        const endEvent = events[endIndex];
        const avgDays =
            intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
        const eventSlice = events.slice(startIndex, endIndex + 1);
        const weekdayCounts = eventSlice.reduce((acc, event) => {
            const weekdayIndex = parseIsoDateUTC(event.date).getUTCDay();
            const weekday = WEEKDAYS[weekdayIndex];
            acc[weekday] = (acc[weekday] || 0) + 1;
            return acc;
        }, {});
        let dominantWeekday = null;
        let dominantCount = 0;
        Object.entries(weekdayCounts).forEach(([weekday, count]) => {
            if (count > dominantCount) {
                dominantWeekday = weekday;
                dominantCount = count;
            }
        });
        const weekdayRatio =
            eventSlice.length > 0 ? dominantCount / eventSlice.length : 0;
        return {
            startDate: startEvent.date,
            endDate: endEvent.date,
            count: intervals.length,
            avgDays: Number(avgDays.toFixed(1)),
            classification,
            isReliable: intervals.length >= MIN_SEGMENT_INTERVALS,
            weekday: dominantWeekday,
            weekdayRatio: Number(weekdayRatio.toFixed(3)),
        };
    });
}

async function detectForTicker(ticker, navInfo) {
    const fileName = ticker.replace(/\./g, '-').toLowerCase() + '.json';
    const filePath = path.join(DATA_DIR, fileName);

    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const json = JSON.parse(raw);

        const dividendEvents = (json.backtestData || [])
            .filter(
                (item) =>
                    item.amount !== undefined || item.amountFixed !== undefined
            )
            .map((item) => ({
                date: item.date,
                amount:
                    item.amountFixed !== undefined
                        ? item.amountFixed
                        : item.amount,
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        const segments = buildSegments(dividendEvents);

        const reliableSegments = segments.filter((s) => s.isReliable);
        const baseSegments =
            reliableSegments.length >= 2 ? reliableSegments : segments;

        const frequencyChanges = [];
        for (let i = 1; i < baseSegments.length; i += 1) {
            const prev = baseSegments[i - 1];
            const next = baseSegments[i];
            if (prev.classification.label !== next.classification.label) {
                frequencyChanges.push({
                    date: next.startDate,
                    from: prev.classification.label,
                    to: next.classification.label,
                    previousAvgDays: prev.avgDays,
                    nextAvgDays: next.avgDays,
                    confidence:
                        prev.isReliable && next.isReliable ? 'high' : 'low',
                });
            }
        }

        const splits = (json.backtestData || [])
            .filter((item) => item.split)
            .map((item) => ({
                date: item.date,
                ratio: item.split,
                type: inferSplitType(item.split),
            }));

        const filteredSplits = splits.filter(
            (split) => !isNeutralSplit(split.ratio)
        );

        const existingFrequencyChanges = Array.isArray(
            json.tickerInfo?.events?.frequencyChanges
        )
            ? json.tickerInfo.events.frequencyChanges
            : [];
        const existingSplits = Array.isArray(
            json.tickerInfo?.events?.splits
        )
            ? json.tickerInfo.events.splits
            : [];
        const existingWeekdayChanges = Array.isArray(
            json.tickerInfo?.events?.weekdayChanges
        )
            ? json.tickerInfo.events.weekdayChanges
            : [];

        const existingFrequencySignatures = new Set(
            existingFrequencyChanges.map((change) =>
                [
                    change.date || '',
                    change.from || '',
                    change.to || '',
                ].join('|')
            )
        );
        const existingSplitSignatures = new Set(
            existingSplits.map((split) =>
                [
                    split.date || '',
                    split.ratio || '',
                    split.type || '',
                ].join('|')
            )
        );

        const filteredFrequencyChanges = frequencyChanges.filter((change) => {
            const signature = [
                change.date || '',
                change.from || '',
                change.to || '',
            ].join('|');
            return !existingFrequencySignatures.has(signature);
        });

        const newSplits = filteredSplits.filter((split) => {
            const signature = [
                split.date || '',
                split.ratio || '',
                split.type || '',
            ].join('|');
            return !existingSplitSignatures.has(signature);
        });

        const weekdayChanges = [];
        for (let i = 1; i < baseSegments.length; i += 1) {
            const prev = baseSegments[i - 1];
            const next = baseSegments[i];
            if (
                prev.classification.label === next.classification.label &&
                prev.weekday &&
                next.weekday &&
                prev.weekday !== next.weekday
            ) {
                const confidence =
                    prev.isReliable &&
                    next.isReliable &&
                    prev.weekdayRatio >= 0.6 &&
                    next.weekdayRatio >= 0.6
                        ? 'high'
                        : 'low';
                weekdayChanges.push({
                    date: next.startDate,
                    from: prev.weekday,
                    to: next.weekday,
                    previousRatio: prev.weekdayRatio,
                    nextRatio: next.weekdayRatio,
                    confidence,
                });
            }
        }

        const existingWeekdaySignatures = new Set(
            existingWeekdayChanges.map((change) =>
                [
                    change.date || '',
                    change.from || '',
                    change.to || '',
                ].join('|')
            )
        );

        const filteredWeekdayChanges = weekdayChanges.filter((change) => {
            const signature = [
                change.date || '',
                change.from || '',
                change.to || '',
            ].join('|');
            return !existingWeekdaySignatures.has(signature);
        });

        return {
            symbol: ticker,
            company: navInfo?.company,
            frequency: navInfo?.frequency,
            detectedSegments: segments,
            detectedFrequencyChanges: filteredFrequencyChanges,
            detectedSplits: newSplits,
            detectedWeekdayChanges: filteredWeekdayChanges,
            eventCount: dividendEvents.length,
        };
    } catch (error) {
        return {
            symbol: ticker,
            error: error.message || String(error),
        };
    }
}

function inferSplitType(ratioStr) {
    if (!ratioStr) return 'split';
    const [num, denom] = ratioStr.split(':').map(Number);
    if (!num || !denom) return 'split';
    if (num < denom) return 'reverse-split';
    if (num > denom) return 'split';
    return 'split';
}

function isNeutralSplit(ratioStr) {
    if (!ratioStr) return false;
    const [num, denom] = ratioStr.split(':').map(Number);
    if (!Number.isFinite(num) || !Number.isFinite(denom) || denom === 0) {
        return false;
    }
    return Math.abs(num - denom) < 1e-9;
}

async function ensureOutputDir(filePath) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
}

async function main() {
    const navItems = await loadNav();
    const filteredNav = navItems.filter((item) => {
        if (item.upcoming) return false;
        if (requestedCompany && item.company !== requestedCompany) return false;
        if (requestedSymbols)
            return requestedSymbols.includes(item.symbol.toUpperCase());
        return true;
    });

    console.log(
        `🔍 감지 대상 종목: ${filteredNav.length}개` +
            (requestedCompany ? ` (company=${requestedCompany})` : '') +
            (requestedSymbols ? ` (symbols=${requestedSymbols.join(',')})` : '')
    );

    const results = [];
    for (const item of filteredNav) {
        const result = await detectForTicker(item.symbol, item);
        results.push(result);
    }

    const summaries = results
        .filter((r) => !r.error)
        .map((r) => ({
            symbol: r.symbol,
            company: r.company,
            eventCount: r.eventCount,
            segmentCount: r.detectedSegments.length,
            frequencyChangeCount: r.detectedFrequencyChanges.length,
            splitCount: r.detectedSplits.length,
            weekdayChangeCount: r.detectedWeekdayChanges.length,
        }));

    await ensureOutputDir(outputPath);
    await fs.writeFile(
        outputPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                filters: {
                    company: requestedCompany,
                    symbols: requestedSymbols,
                },
                summary: summaries,
                details: results,
            },
            null,
            2
        )
    );

    const templateEntries = results
        .filter((r) => !r.error)
        .map((r) => ({
            symbol: r.symbol,
            frequencyChanges: (r.detectedFrequencyChanges || []).map(
                (change) => ({
                    date: change.date,
                    from: change.from,
                    to: change.to,
                    confidence: change.confidence,
                    apply: false,
                })
            ),
            splits: (r.detectedSplits || []).map((split) => ({
                date: split.date,
                ratio: split.ratio,
                type: split.type,
                apply: false,
            })),
            weekdayChanges: (r.detectedWeekdayChanges || []).map((change) => ({
                date: change.date,
                from: change.from,
                to: change.to,
                confidence: change.confidence,
                previousRatio: change.previousRatio,
                nextRatio: change.nextRatio,
                apply: false,
            })),
        }))
        .filter(
            (entry) =>
                entry.frequencyChanges.length > 0 ||
                entry.splits.length > 0 ||
                entry.weekdayChanges.length > 0
        );

    if (templateEntries.length > 0) {
        await ensureOutputDir(templatePath);
        await fs.writeFile(
            templatePath,
            JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    sourceReport: path.relative(ROOT_DIR, outputPath),
                    entries: templateEntries,
                },
                null,
                2
            )
        );
    }

    const changed = summaries.filter(
        (s) =>
            s.frequencyChangeCount > 0 ||
            s.splitCount > 0 ||
            s.weekdayChangeCount > 0
    );

    console.log(`📄 보고서 생성: ${outputPath}`);
    if (templateEntries.length > 0) {
        console.log(
            `📝 검토용 템플릿 생성: ${templatePath} (엔트리 ${templateEntries.length}개)`
        );
    } else {
        console.log(
            'ℹ️ 적용 가능한 이벤트가 없어 템플릿은 생성하지 않았습니다.'
        );
    }
    console.log(
        `   ▶ 이벤트 감지된 종목: ${changed.length}개 / 전체 ${summaries.length}개`
    );

    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
        console.warn('⚠️  처리 중 오류가 발생한 종목이 있습니다:');
        errors.forEach((err) =>
            console.warn(`   - ${err.symbol}: ${err.error}`)
        );
    }
}

main().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
});
