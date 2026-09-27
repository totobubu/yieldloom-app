import { createNumericFormatter } from '@/utils/formatters';

export interface ChartTheme {
    textColor: string;
    textColorSecondary: string;
    surfaceBorder: string;
}

export interface MonthlyChartOptions {
    data: any[];
    theme: ChartTheme;
    currency?: 'USD' | 'KRW';
}

export function useMonthlyChart(options: MonthlyChartOptions) {
    const { data, theme, currency = 'USD' } = options;
    const { textColor, textColorSecondary, surfaceBorder } = theme;
    const formatCurrency = createNumericFormatter(currency, {
        maximumFractionDigits: 4,
    });

    const reversedData = [...data].reverse();
    const labels = reversedData.map((item) => item['배당락']);

    const parsedData = reversedData.map((item) => {
        // 차트 표시용 금액: 배당금 필드 사용 (useStockData에서 이미 처리됨)
        const 배당금 = item['배당금'];
        const displayAmount = typeof 배당금 === 'number' ? 배당금 : 0;

        // Split 조정값 (툴팁용)
        const splitAdjusted = item.amount;
        const hasSplits = item.amountSplitAdjustments && item.amountSplitAdjustments.length > 0;

        return {
            ...item,
            displayAmount,
            splitAdjusted,
            hasSplits,
        };
    });

    const dividendData = parsedData.map((item) => item.displayAmount);
    const chartContainerHeight = `${Math.max(250, data.length * 40)}px`;

    const chartOptions = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params: any) => {
                const index = params[0].dataIndex;
                const item = parsedData[index];
                const receivedAmount = params[0].value; // 실제 받은 금액 (차트값)

                let tooltip = `${params[0].name}<br/>배당금: <strong>${formatCurrency(receivedAmount)}</strong>`;

                // Split이 있으면 조정값도 표시
                if (item.hasSplits && item.splitAdjusted !== receivedAmount) {
                    const multiplier = receivedAmount > 0
                        ? (item.splitAdjusted / receivedAmount).toFixed(1)
                        : '0.0';
                    tooltip += `<br/><span style="color: #888;">Split 조정: ${formatCurrency(item.splitAdjusted)} (${multiplier}x)</span>`;
                }

                return tooltip;
            },
        },
        grid: { left: '3%', right: '15%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'value',
            axisLabel: {
                color: textColorSecondary,
                formatter: (val: number) => formatCurrency(val).replace(/[$,₩]/, ''),
            },
            splitLine: { lineStyle: { color: surfaceBorder, type: 'dashed' } },
        },
        yAxis: {
            type: 'category',
            data: labels,
            axisLabel: { color: textColorSecondary },
        },
        series: [
            {
                name: '배당금',
                type: 'bar',
                data: dividendData,
                label: {
                    show: true,
                    position: 'right',
                    formatter: (params: any) => formatCurrency(params.value),
                    color: textColor,
                },
            },
        ],
    };

    return { chartOptions, chartContainerHeight };
}
