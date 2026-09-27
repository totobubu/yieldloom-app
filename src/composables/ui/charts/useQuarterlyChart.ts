import { parseYYMMDD } from '@/utils/date';
import { createNumericFormatter } from '@/utils/formatters';
import { monthColors } from '@/utils/chartUtils';

export interface ChartTheme {
    textColor: string;
    textColorSecondary: string;
    surfaceBorder: string;
}

export interface QuarterlyChartOptions {
    data: any[];
    theme: ChartTheme;
    currency?: 'USD' | 'KRW';
    aggregation?: 'quarter' | 'month';
}

export function useQuarterlyChart(options: QuarterlyChartOptions) {
    const { data, theme, currency = 'USD', aggregation = 'quarter' } = options;
    const { textColor, textColorSecondary, surfaceBorder } = theme;
    const formatCurrency = createNumericFormatter(currency);
    const quarterColors = ['#4285F4', '#EA4335', '#FBBC04', '#34A853'];

    // 연도별 데이터 집계
    const yearlyData = data.reduce((acc: any, item: any) => {
        const date = parseYYMMDD(item['배당락']);
        if (!date) return acc;
        const year = date.getFullYear().toString();
        const subCategory =
            aggregation === 'quarter'
                ? Math.floor(date.getMonth() / 3)
                : date.getMonth();

        // 차트 표시용 금액: 배당금 필드 사용 (useStockData에서 이미 처리됨)
        const 배당금 = item['배당금'];
        const displayAmount = typeof 배당금 === 'number' ? 배당금 : 0;

        // Split 조정값 (툴팁용)
        const splitAdjusted = item.amount;
        const hasSplits = item.amountSplitAdjustments && item.amountSplitAdjustments.length > 0;

        if (!acc[year]) {
            acc[year] = {
                amounts: aggregation === 'quarter' ? [0, 0, 0, 0] : Array(12).fill(0),
                splitAdjusted: aggregation === 'quarter' ? [0, 0, 0, 0] : Array(12).fill(0),
                hasSplits: false,
            };
        }

        acc[year].amounts[subCategory] += displayAmount;
        if (hasSplits && splitAdjusted !== undefined) {
            acc[year].splitAdjusted[subCategory] += splitAdjusted;
            acc[year].hasSplits = true;
        }

        return acc;
    }, {});

    const years = Object.keys(yearlyData).sort(
        (a, b) => parseInt(a) - parseInt(b)
    );
    const chartContainerHeight = `${Math.max(250, years.length * 60)}px`;

    const subCategories =
        aggregation === 'quarter'
            ? [0, 1, 2, 3]
            : Array.from({ length: 12 }, (_, i) => i);
    const subCategoryLabels =
        aggregation === 'quarter'
            ? ['1분기', '2분기', '3분기', '4분기']
            : Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
    const colorMap =
        aggregation === 'quarter' ? quarterColors : Object.values(monthColors);

    const series = subCategories.map((sc, i) => ({
        name: subCategoryLabels[i],
        type: 'bar',
        stack: 'total',
        label: {
            show: true,
            formatter: (params: any) =>
                params.value > 0 ? formatCurrency(params.value) : '',
        },
        emphasis: { focus: 'series' },
        data: years.map((year) => yearlyData[year].amounts[sc]),
        itemStyle: { color: colorMap[i] },
    }));

    series.push({
        name: '연간 총액',
        type: 'bar',
        stack: 'total',
        label: {
            show: true,
            position: 'right',
            formatter: (params: any) => {
                const total = yearlyData[params.name].amounts.reduce(
                    (sum: number, val: number) => sum + val,
                    0
                );
                return total > 0 ? formatCurrency(total) : '';
            },
            color: textColor,
            fontWeight: 'bold',
        } as any,
        data: years.map(() => 0),
    } as any);

    const chartOptions = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params: any) => {
                const year = params[0].name;
                const yearData = yearlyData[year];
                const total = yearData.amounts.reduce(
                    (sum: number, val: number) => sum + val,
                    0
                );
                const totalSplitAdjusted = yearData.splitAdjusted.reduce(
                    (sum: number, val: number) => sum + val,
                    0
                );

                let tooltip = `${year}년<br/>`;
                params
                    .filter((p: any) => p.seriesName !== '연간 총액' && p.value > 0)
                    .forEach((p: any) => {
                        tooltip += `${p.marker} ${p.seriesName}: <strong>${formatCurrency(p.value)}</strong><br/>`;
                    });
                tooltip += `<strong>총액: ${formatCurrency(total)}</strong>`;

                // Split이 있으면 조정값도 표시
                if (yearData.hasSplits && totalSplitAdjusted !== total) {
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
            data: years,
            axisLabel: { color: textColorSecondary },
        },
        series: series,
    };

    return { chartOptions, chartContainerHeight };
}
