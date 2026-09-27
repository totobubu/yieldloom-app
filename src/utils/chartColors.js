// src/utils/chartColors.js

const colorPalettes = {
    A: {
        dividend: '#F4CCCC',
        highlight: '#FE0000',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#FE0000',
        openPrice: '#FF8A80',
        nextPrice: '#D32F2F',
        dividendText: '#212121',
        highlightText: '#FFFFFF',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#FFFFFF',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    B: {
        dividend: '#FFF2CD',
        highlight: '#FABD03',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#FABD03',
        openPrice: '#FFD180',
        nextPrice: '#F57F17',
        dividendText: '#212121',
        highlightText: '#212121',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#212121',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    C: {
        dividend: '#D8EAD2',
        highlight: '#34A853',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#34A853',
        openPrice: '#B9F6CA',
        nextPrice: '#1B5E20',
        dividendText: '#212121',
        highlightText: '#FFFFFF',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#FFFFFF',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    D: {
        dividend: '#CFE2F3',
        highlight: '#4A86E8',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#4A86E8',
        openPrice: '#82B1FF',
        nextPrice: '#2962FF',
        dividendText: '#212121',
        highlightText: '#FFFFFF',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#FFFFFF',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    월: {
        dividend: '#E1D5E7',
        highlight: '#9900FF',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#9900FF',
        openPrice: '#EA80FC',
        nextPrice: '#6A1B9A',
        dividendText: '#212121',
        highlightText: '#FFFFFF',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#FFFFFF',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    화: {
        dividend: '#D0E0E3',
        highlight: '#00B8D4',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#00B8D4',
        openPrice: '#84FFFF',
        nextPrice: '#006064',
        dividendText: '#212121',
        highlightText: '#212121',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#212121',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    수: {
        dividend: '#C6D5F7',
        highlight: '#3D5AFE',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#3D5AFE',
        openPrice: '#8C9EFF',
        nextPrice: '#304FFE',
        dividendText: '#212121',
        highlightText: '#FFFFFF',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#FFFFFF',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    목: {
        dividend: '#FFE0B2',
        highlight: '#FF6D00',
        lineDividend: '#bbbbbb',
        prevPrice: '#BDBDBD',
        currentPrice: '#FF6D00',
        openPrice: '#FFAB40',
        nextPrice: '#E65100',
        dividendText: '#212121',
        highlightText: '#FFFFFF',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#FFFFFF',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    금: {
        dividend: '#F8BBD0',
        highlight: '#E91E63',
        lineDividend: '#5f5f5f',
        prevPrice: '#BDBDBD',
        currentPrice: '#E91E63',
        openPrice: '#FF80AB',
        nextPrice: '#880E4F',
        dividendText: '#212121',
        highlightText: '#FFFFFF',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#FFFFFF',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
    default: {
        dividend: '#757575',
        highlight: '#BDBDBD',
        lineDividend: '#5f5f5f',
        prevPrice: '#9E9E9E',
        currentPrice: '#FAFAFA',
        openPrice: '#E0E0E0',
        nextPrice: '#424242',
        dividendText: '#FFFFFF',
        highlightText: '#212121',
        prevPriceText: '#FFFFFF',
        currentPriceText: '#212121',
        openPriceText: '#212121',
        nextPriceText: '#FFFFFF',
    },
};

export function getChartColorsByGroup(group) {
    return colorPalettes[group] || colorPalettes['default'];
}

// --- [신규] 백테스터 차트 전용 팔레트 ---

const backtesterLightPalette = {
    // 테마
    background: '#F5F5F5',
    textColor: '#1f2937',
    textColorSecondary: '#4b5563',
    gridColor: '#d1d5db',
    // 포트폴리오
    portfolioStock: '#D32F2F', // 주가 영역 (Gemini 추천)
    portfolioCash: '#EF5350', // 현금 영역 (Gemini 추천)
    portfolioDripLine: '#A52020', // 총자산 라인 (Gemini 추천)
    // 비교 지수
    comparisonLine: '#1976D2', // (Gemini 추천)
    // 최고/최저점 마커
    markPoint: {
        symbol: 'diamond',
        symbolSize: 40,
        itemStyle: { color: '#B71C1C' },
        label: {
            fontSize: 14,
            fontWeight: 'bold',
            color: '#FFFFFF',
        },
    },
};

const backtesterDarkPalette = {
    // 테마
    background: '#18181b', // Zinc 900
    textColor: '#f4f4f5',
    textColorSecondary: '#a1a1aa',
    gridColor: '#3f3f46',
    // 포트폴리오
    portfolioStock: '#ef4444', // Red 500
    portfolioCash: '#f97316', // Orange 500
    portfolioDripLine: '#fde047', // Yellow 300 (가장 밝고 강조)
    // 비교 지수
    comparisonLine: '#3b82f6', // Blue 500
    // 최고/최저점 마커
    markPoint: {
        symbol: 'circle',
        symbolSize: 40,
        itemStyle: { color: '#f59e0b' },
        label: {
            fontSize: 14,
            fontWeight: 'bold',
            color: '#000000',
        },
    },
};

export function getBacktesterChartPalette(themeMode = 'dark') {
    return themeMode === 'light'
        ? backtesterLightPalette
        : backtesterDarkPalette;
}
