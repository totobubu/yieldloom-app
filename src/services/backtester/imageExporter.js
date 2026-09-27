// src/services/backtester/imageExporter.js
import { init } from 'echarts/core';
import html2canvas from 'html2canvas';
import { getBacktesterChartPalette } from '@/utils/chartColors.js';

function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(val || 0);
}

function formatPercent(val) {
    return `${((val || 0) * 100).toFixed(2)}%`;
}

function createTableHtml(result) {
    const r = result;
    const comp = r.comparisonResult;
    const rows = [
        {
            label: '초기 투자금',
            drip: formatCurrency(r.initialInvestment),
            noDrip: formatCurrency(r.initialInvestment),
            comp: comp ? formatCurrency(r.initialInvestment) : undefined,
        },
        {
            label: '최종 평가액',
            drip: formatCurrency(r.withReinvest.summary.endingInvestment),
            noDrip: formatCurrency(r.withoutReinvest.summary.endingInvestment),
            comp: comp
                ? formatCurrency(comp.withReinvest.endingInvestment)
                : undefined,
        },
        {
            label: '누적 현금 배당금',
            drip: '-',
            noDrip: formatCurrency(
                r.withoutReinvest.summary.dividendsCollected
            ),
            comp: comp
                ? formatCurrency(comp.withoutReinvest.dividendsCollected)
                : undefined,
        },
        {
            label: '총 수익률',
            drip: formatPercent(r.withReinvest.summary.totalReturn),
            noDrip: formatPercent(r.withoutReinvest.summary.totalReturn),
            comp: comp
                ? formatPercent(comp.withReinvest.totalReturn)
                : undefined,
        },
        {
            label: '연평균 수익률',
            drip: formatPercent(r.withReinvest.summary.cagr),
            noDrip: formatPercent(r.withoutReinvest.summary.cagr),
            comp: comp ? formatPercent(comp.withReinvest.cagr) : undefined,
        },
        {
            label: '기간',
            drip: `${(r.years || 0).toFixed(2)} 년`,
            noDrip: `${(r.years || 0).toFixed(2)} 년`,
            comp: comp ? `${(r.years || 0).toFixed(2)} 년` : undefined,
        },
    ];

    const header = `
        <th style="background: #e5e7eb; color: #111827; border: 1px solid #d1d5db; padding: 0.75rem; text-align: left;">항목</th>
        <th style="background: #e5e7eb; color: #111827; border: 1px solid #d1d5db; padding: 0.75rem; text-align: right;">배당 재투자 O</th>
        <th style="background: #e5e7eb; color: #111827; border: 1px solid #d1d5db; padding: 0.75rem; text-align: right;">배당 재투자 X</th>
        ${comp ? `<th style="background: #e5e7eb; color: #111827; border: 1px solid #d1d5db; padding: 0.75rem; text-align: right;">${r.comparisonSymbol}</th>` : ''}
    `;

    const body = rows
        .map(
            (row, index) => `
        <tr style="${index % 2 === 1 ? 'background-color: #f9fafb;' : ''}">
            <td style="border: 1px solid #e5e7eb; padding: 0.75rem; text-align: left;">${row.label}</td>
            <td style="border: 1px solid #e5e7eb; padding: 0.75rem; text-align: right;">${row.drip}</td>
            <td style="border: 1px solid #e5e7eb; padding: 0.75rem; text-align: right;">${row.noDrip}</td>
            ${comp ? `<td style="border: 1px solid #e5e7eb; padding: 0.75rem; text-align: right;">${row.comp !== undefined ? row.comp : '-'}</td>` : ''}
        </tr>`
        )
        .join('');

    return `
        <table style="width: 100%; border-collapse: collapse; margin-top: 1rem; color: #1f2937; font-size: 14px;">
            <thead><tr>${header}</tr></thead>
            <tbody>${body}</tbody>
        </table>`;
}

export async function exportResultsAsImage(result, chartOption, chartTitle) {
    if (!result) return;

    const lightPalette = getBacktesterChartPalette('light');
    const IMAGE_WIDTH = 600;

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '-9999px';
    container.style.left = '0px';
    container.style.width = `${IMAGE_WIDTH}px`;
    container.style.padding = '0.5rem';
    container.style.backgroundColor = lightPalette.background;
    container.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    document.body.appendChild(container);

    const titleElement = document.createElement('h2');
    titleElement.innerText = chartTitle;
    titleElement.style.textAlign = 'center';
    titleElement.style.color = lightPalette.textColor;
    titleElement.style.fontSize = '18px';
    titleElement.style.fontWeight = 'bold';
    titleElement.style.marginBottom = '1rem';
    container.appendChild(titleElement);

    const chartDiv = document.createElement('div');
    chartDiv.style.width = '100%';
    chartDiv.style.height = `${IMAGE_WIDTH * 0.75}px`;
    container.appendChild(chartDiv);

    const lightChartOptions = JSON.parse(JSON.stringify(chartOption));
    lightChartOptions.title.text = '';
    lightChartOptions.animation = false;
    lightChartOptions.backgroundColor = lightPalette.background;
    lightChartOptions.legend.textStyle.color = lightPalette.textColorSecondary;
    lightChartOptions.xAxis.axisLabel.color = lightPalette.textColorSecondary;
    lightChartOptions.yAxis.axisLabel.color = lightPalette.textColorSecondary;
    lightChartOptions.xAxis.splitLine.lineStyle.color = lightPalette.gridColor;
    lightChartOptions.yAxis.splitLine.lineStyle.color = lightPalette.gridColor;
    lightChartOptions.dataZoom = [];

    const tableHtml = createTableHtml(result);
    container.insertAdjacentHTML('beforeend', tableHtml);

    let tempChart;
    try {
        tempChart = init(chartDiv);
        tempChart.setOption(lightChartOptions);
        await new Promise((resolve) => setTimeout(resolve, 500));

        const canvas = await html2canvas(container, {
            useCORS: true,
            scale: 2,
        });
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'backtest-result.png';
        link.click();
    } catch (error) {
        console.error('Failed to download results as image:', error);
        throw new Error('이미지 생성에 실패했습니다.');
    } finally {
        if (tempChart) tempChart.dispose();
        document.body.removeChild(container);
    }
}
