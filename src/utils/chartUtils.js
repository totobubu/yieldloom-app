// src/utils/chartUtils.js
import { parseYYMMDD } from '@/utils/date.js'; // [추가] parseYYMMDD 함수를 import 합니다.

// [신규] 월별 누적 차트를 위한 12색상 팔레트 추가
export const monthColors = {
    1: '#a8c6f5', // Jan (Light Blue)
    2: '#87b4f3', // Feb
    3: '#4285F4', // Mar (Blue)
    4: '#b7e1cd', // Apr (Light Green)
    5: '#81c995', // May
    6: '#34A853', // Jun (Green)
    7: '#fce8b2', // Jul (Light Yellow)
    8: '#fdd663', // Aug
    9: '#FBBC04', // Sep (Yellow)
    10: '#f8c5b9', // Oct (Light Red)
    11: '#f28b82', // Nov
    12: '#EA4335', // Dec (Red)
};

/**
 * nav.json의 periods 배열 또는 문자열을 기반으로 차트 기간 옵션 배열을 생성합니다.
 * @param {string[] | string | undefined} periods - nav.json에서 가져온 기간 배열 또는 문자열
 * @returns {Array<{label: string, value: string}>} PrimeVue SelectButton/Dropdown용 옵션 배열
 */
export const generateTimeRangeOptions = (periods) => {
    // periods 값이 없으면 '전체' 옵션만 반환
    if (!periods || periods.length === 0) {
        return [{ label: '전체', value: 'ALL' }];
    }

    let periodsArray;
    // 입력값이 배열이면 그대로 사용, 문자열이면 쉼표로 분리하여 배열로 변환
    if (Array.isArray(periods)) {
        periodsArray = periods;
    } else if (typeof periods === 'string') {
        periodsArray = periods.split(',').map((p) => p.trim());
    } else {
        // 그 외의 경우 (예: 잘못된 데이터 타입)
        return [{ label: '전체', value: 'ALL' }];
    }

    // "ALL"을 필터링하고 옵션 객체 배열 생성
    const options = periodsArray
        .filter((p) => p.toUpperCase() !== 'ALL')
        .map((part) => ({ label: part, value: part }));

    // 마지막에 '전체' 옵션을 항상 추가
    options.push({ label: '전체', value: 'ALL' });

    return options;
};

// --- 동적 스타일 계산 함수 ---

export function getDynamicChartWidth(itemCount, deviceType, itemWidth = 45) {
    if (deviceType !== 'mobile') return '100%';
    if (itemCount <= 6) return '100%';
    return `${itemCount * itemWidth}px`;
}

export function getChartAspectRatio(deviceType) {
    if (deviceType === 'mobile') return null;
    if (deviceType === 'desktop') return 16 / 10;
    if (deviceType === 'tablet') return 3 / 2;
    return 16 / 10;
}

// --- 폰트 크기 계산 함수 ---

export function getBarStackFontSize(itemCount, deviceType, type = 'default') {
    let baseSize = type === 'total' ? 18 : 18;
    let finalSize;

    if (itemCount == 1) finalSize = baseSize + 12;
    else if (itemCount == 2) finalSize = baseSize + 6;
    else if (itemCount == 3) finalSize = baseSize + 6;
    else if (itemCount == 4) finalSize = baseSize + 5;
    else if (itemCount == 5) finalSize = baseSize + 5;
    else if (itemCount == 6) finalSize = baseSize + 3;
    else if (itemCount == 7) finalSize = baseSize + 2;
    else if (itemCount == 8) finalSize = baseSize + 1;
    else if (itemCount == 9) finalSize = baseSize + 0;
    else if (itemCount == 10) finalSize = baseSize - 4;
    else if (itemCount == 11) finalSize = baseSize - 5;
    else if (itemCount == 12) finalSize = baseSize - 5;
    else if (itemCount == 13) finalSize = baseSize - 6;
    else if (itemCount == 14) finalSize = baseSize - 6;
    else if (itemCount <= 15) finalSize = baseSize;
    else finalSize = baseSize - 7;
    if (deviceType === 'tablet') finalSize *= 0.75;
    if (deviceType === 'mobile') finalSize *= 0.4;
    return Math.max(8, Math.round(finalSize));
}

export function getPriceChartFontSize(itemCount, deviceType, type = 'default') {
    let baseSize = type === 'line' ? 13 : type === 'axis' ? 12 : 14;
    let finalSize;
    if (itemCount <= 7) finalSize = baseSize + 2;
    else if (itemCount <= 15) finalSize = baseSize;
    else if (itemCount <= 30) finalSize = baseSize - 2;
    else if (itemCount <= 60) finalSize = baseSize - 3;
    else finalSize = baseSize - 4;
    if (deviceType === 'tablet') finalSize *= 0.9;
    if (deviceType === 'mobile') finalSize *= 0.8;
    return Math.max(9, Math.round(finalSize));
}

// --- 차트 옵션 및 데이터셋 생성 헬퍼 함수 ---

export function getCommonPlugins(options) {
    const { theme, tooltipCallbacks = {}, legendDisplay = false } = options;
    const { textColor, tickFontSize, zoomOptions } = theme;
    return {
        title: { display: false },
        legend: {
            display: legendDisplay,
            position: 'top',
            labels: { color: textColor, font: { size: tickFontSize } },
        },
        tooltip: { mode: 'index', intersect: false, ...tooltipCallbacks },
        zoom: zoomOptions,
    };
}

export function createStackedBarDatasets(config) {
    const {
        aggregatedData,
        primaryLabels,
        colorMap,
        labelPrefix,
        dataLabelConfig,
        totalLabelConfig,
    } = config;

    const secondaryKeys = [
        ...new Set(
            Object.values(aggregatedData).flatMap((m) => Object.keys(m.stacks))
        ),
    ]
        .map(Number)
        .sort();

    const datasets = secondaryKeys.map((key) => ({
        type: 'bar',
        label: `${key}${labelPrefix}`,
        backgroundColor: colorMap[key],
        data: primaryLabels.map(
            (label) => aggregatedData[label].stacks[key] || 0
        ),
        datalabels: dataLabelConfig,
    }));

    datasets.push({
        type: 'bar',
        label: 'Total',
        data: new Array(primaryLabels.length).fill(0),
        backgroundColor: 'transparent',
        datalabels: totalLabelConfig,
    });

    return datasets;
}
