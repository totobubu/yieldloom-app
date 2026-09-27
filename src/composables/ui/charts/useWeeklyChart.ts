import { parseYYMMDD } from '@/utils/date';
import { createNumericFormatter } from '@/utils/formatters';

export interface ChartTheme {
    textColor: string;
    textColorSecondary: string;
    surfaceBorder: string;
}

export interface WeeklyChartOptions {
    data: any[];
    theme: ChartTheme;
    currency?: 'USD' | 'KRW';
}

export function useWeeklyChart(options: WeeklyChartOptions) {
    const { data, theme, currency = 'USD' } = options;
    const { textColor, textColorSecondary, surfaceBorder } = theme;
    const formatCurrency = createNumericFormatter(currency, {
        maximumFractionDigits: 4,
    });
    const weekColors = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01'];

    // 월별 데이터 집계
    const monthlyAggregated = data.reduce((acc: any, item: any) => {
        const date = parseYYMMDD(item['배당락']);
        if (!date) return acc;
        const yearMonth = `${date.getFullYear().toString().slice(-2)}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        const weekOfMonth = Math.floor((date.getDate() - 1) / 7);

        // 차트 표시용 금액: 배당금 필드 사용 (useStockData에서 이미 처리됨)
        const 배당금 = item['배당금'];
        const displayAmount = typeof 배당금 === 'number' ? 배당금 : 0;

        // Split 조정값 (툴팁용)
        const splitAdjusted = item.amount;
        const hasSplits = item.amountSplitAdjustments && item.amountSplitAdjustments.length > 0;

        if (!acc[yearMonth]) {
            acc[yearMonth] = {
                weeks: [0, 0, 0, 0, 0],
                splitAdjusted: [0, 0, 0, 0, 0],
                total: 0,
                totalSplitAdjusted: 0,
                hasSplits: false,
            };
        }

        if (weekOfMonth < 5) {
            acc[yearMonth].weeks[weekOfMonth] += displayAmount;
            acc[yearMonth].total += displayAmount;

            if (hasSplits && splitAdjusted !== undefined) {
                acc[yearMonth].splitAdjusted[weekOfMonth] += splitAdjusted;
                acc[yearMonth].totalSplitAdjusted += splitAdjusted;
                acc[yearMonth].hasSplits = true;
            }
        }
        return acc;
    }, {});

    const months = Object.keys(monthlyAggregated).sort((a, b) => {
        const [ya, ma] = a.split('.').map(Number);
        const [yb, mb] = b.split('.').map(Number);
        if (ya !== yb) return ya - yb;
        return ma - mb;
    });

    const chartContainerHeight = `${Math.max(250, months.length * 60)}px`;

    const series = [0, 1, 2, 3, 4].map((w) => ({
        name: `${w + 1}주차`,
        type: 'bar',
        stack: 'total',
        label: {
            show: true,
            formatter: (params: any) =>
                params.value > 0 ? formatCurrency(params.value) : '',
        },
        emphasis: { focus: 'series' },
        data: months.map((month) => monthlyAggregated[month].weeks[w]),
        itemStyle: { color: weekColors[w] },
    }));

    series.push({
        name: '월간 총액',
        type: 'bar',
        stack: 'total',
        label: {
            show: true,
            position: 'right',
            formatter: (params: any) =>
                formatCurrency(monthlyAggregated[params.name].total),
            color: textColor,
            fontWeight: 'bold',
        } as any,
        data: months.map(() => 0),
    } as any);

    const chartOptions = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params: any) => {
                const month = params[0].name;
                const monthData = monthlyAggregated[month];
                const total = monthData.total;
                const totalSplitAdjusted = monthData.totalSplitAdjusted;

                let tooltip = `${month}<br/>`;
                params
                    .filter((p: any) => p.seriesName !== '월간 총액' && p.value > 0)
                    .forEach((p: any) => {
                        tooltip += `${p.marker} ${p.seriesName}: <strong>${formatCurrency(p.value)}</strong><br/>`;
                    });
                tooltip += `<strong>총액: ${formatCurrency(total)}</strong>`;

                // Split이 있으면 조정값도 표시
                if (monthData.hasSplits && totalSplitAdjusted !== total) {
                    const multiplier = total > 0
                        ? (totalSplitAdjusted / total).toFixed(1)
                        : '0.0';
                    tooltip += `<br/><span style="color: #888;">Split 조정: ${formatCurrency(totalSplitAdjusted)} (${multiplier}x)</span>`;
                }

                return tooltip;
            },
        },
        legend: { show: true, textStyle: { color: textColorSecondary } },
        grid: { left: '3%', right: '15%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'value',
            axisLabel: { color: textColorSecondary },
            splitLine: { lineStyle: { color: surfaceBorder, type: 'dashed' } },
        },
        yAxis: {
            type: 'category',
            data: months,
            axisLabel: { color: textColorSecondary },
        },
        series: series,
    };

    return { chartOptions, chartContainerHeight };
}
