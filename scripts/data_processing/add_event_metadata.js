// scripts/add_event_metadata.js
//
// 배당 주기 변경일, 주식 병합/분할일 등을 기존 data JSON 파일에 주입하는
// 일회성 스크립트입니다. CONFIG 상수를 편집해 원하는 티커에 대한 이벤트를
// 정의한 뒤 `node scripts/add_event_metadata.js`로 실행하세요.
//
// - 이미 동일한 이벤트가 기록돼 있으면 중복 없이 유지됩니다.
// - `tickerInfo` 또는 `tickerInfo.events`가 없으면 자동으로 생성합니다.
// - 필요한 경우 frequencyChanges/splits 외의 카테고리도 확장할 수 있습니다.

import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data');

/**
 * 이벤트 정의:
 *  - symbol: 티커 심볼 (nav.json 기준)
 *  - frequencyChanges: [{ date: 'YYYY-MM-DD', from: '4주', to: '매주' }]
 *  - splits: [{ date: 'YYYY-MM-DD', ratio: '1:5', type: 'split' }]
 *  - weekdayChanges: [{ date: 'YYYY-MM-DD', from: '목', to: '수' }]
 *
 * 필요에 따라 다른 카테고리를 추가할 수 있습니다.
 *
 * 외부 구성 파일 사용 방법:
 *   node scripts/add_event_metadata.js --config=scripts/output/events-config-template.json
 * 템플릿 파일에서는 apply=true인 항목만 실제로 반영됩니다.
 */
const DEFAULT_CONFIG = [
    {
        symbol: 'ULTY',
        frequencyChanges: [{ date: '2024-09-18', from: '4주', to: '매주' }],
        splits: [],
        weekdayChanges: [],
    },
];

const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
        return [key, value];
    })
);

const externalConfigPath = args.config
    ? path.resolve(args.config)
    : null;

const loadExternalConfig = (configPath) => {
    if (!fs.existsSync(configPath)) {
        throw new Error(`구성 파일을 찾을 수 없습니다: ${configPath}`);
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.entries)
          ? parsed.entries
          : [];

    const normalizeEvent = (event) => ({
        date: event.date,
        from: event.from,
        to: event.to,
    });
    const normalizeSplit = (event) => ({
        date: event.date,
        ratio: event.ratio,
        type: event.type,
    });
    const normalizeWeekday = (event) => ({
        date: event.date,
        from: event.from,
        to: event.to,
    });

    return entries
        .map((entry) => {
            const frequencyChanges = (entry.frequencyChanges || [])
                .filter((item) => item.apply === true || item.apply === undefined)
                .map(normalizeEvent);
            const splits = (entry.splits || [])
                .filter((item) => item.apply === true || item.apply === undefined)
                .map(normalizeSplit);
            const weekdayChanges = (entry.weekdayChanges || [])
                .filter((item) => item.apply === true || item.apply === undefined)
                .map(normalizeWeekday);

            return {
                symbol: entry.symbol,
                frequencyChanges,
                splits,
                weekdayChanges,
            };
        })
        .filter(
            (entry) =>
                entry.symbol &&
                ((entry.frequencyChanges && entry.frequencyChanges.length > 0) ||
                    (entry.splits && entry.splits.length > 0) ||
                    (entry.weekdayChanges && entry.weekdayChanges.length > 0))
        );
};

const CONFIG = externalConfigPath
    ? loadExternalConfig(externalConfigPath)
    : DEFAULT_CONFIG;

if (externalConfigPath) {
    console.log(
        `외부 구성 파일을 사용합니다: ${path.relative(ROOT_DIR, externalConfigPath)}`
    );
}

if (!CONFIG.length) {
    console.warn('적용할 이벤트가 없습니다. 스크립트를 종료합니다.');
    process.exit(0);
}

const dedupeByKeys = (items, keys) => {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const signature = keys.map((k) => item[k]).join('|');
        if (!seen.has(signature)) {
            seen.add(signature);
            result.push(item);
        }
    }
    return result;
};

for (const entry of CONFIG) {
    const fileName = entry.symbol.replace(/\./g, '-').toLowerCase() + '.json';
    const filePath = path.join(DATA_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        console.warn(
            `⚠️  ${entry.symbol}: 파일을 찾을 수 없습니다. (${filePath})`
        );
        continue;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(raw);

        json.tickerInfo = json.tickerInfo || {};
        json.tickerInfo.events = json.tickerInfo.events || {};

        if (entry.frequencyChanges?.length) {
            const existing = Array.isArray(
                json.tickerInfo.events.frequencyChanges
            )
                ? json.tickerInfo.events.frequencyChanges
                : [];
            json.tickerInfo.events.frequencyChanges = dedupeByKeys(
                [...existing, ...entry.frequencyChanges],
                ['date', 'from', 'to']
            ).sort((a, b) => new Date(a.date) - new Date(b.date));
        }

        if (entry.splits?.length) {
            const existing = Array.isArray(json.tickerInfo.events.splits)
                ? json.tickerInfo.events.splits
                : [];
            json.tickerInfo.events.splits = dedupeByKeys(
                [...existing, ...entry.splits],
                ['date', 'ratio', 'type']
            ).sort((a, b) => new Date(a.date) - new Date(b.date));
        }

        if (entry.weekdayChanges?.length) {
            const existing = Array.isArray(json.tickerInfo.events.weekdayChanges)
                ? json.tickerInfo.events.weekdayChanges
                : [];
            json.tickerInfo.events.weekdayChanges = dedupeByKeys(
                [...existing, ...entry.weekdayChanges],
                ['date', 'from', 'to']
            ).sort((a, b) => new Date(a.date) - new Date(b.date));
        }

        fs.writeFileSync(filePath, JSON.stringify(json, null, 4));
        console.log(`✅ ${entry.symbol}: 이벤트 정보를 업데이트했습니다.`);
    } catch (error) {
        console.error(`❌ ${entry.symbol}: 처리 중 오류 발생`, error);
    }
}

console.log('적용이 완료되었습니다.');
