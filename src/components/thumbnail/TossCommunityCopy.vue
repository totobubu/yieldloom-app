<script setup>
    import { computed, ref } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    const props = defineProps({ data: { type: Object, required: true } });
    const copied = ref(false);
    const copyError = ref('');
    const usd = (v, n = 4) =>
        v != null && Number.isFinite(Number(v))
            ? `$${Number(v)
                  .toFixed(n)
                  .replace(/\.?(0+)$/, '')}`
            : '데이터 없음';
    const pct = (v) =>
        v != null && Number.isFinite(Number(v))
            ? `${Number(v).toFixed(2)}%`
            : null;
    const text = computed(() => {
        const d = props.data;
        if (!d.hasDividend)
            return `${d.symbol} 최근 배당 정보\n\n최근 실제 배당 데이터를 찾지 못했습니다.`;
        const lines = [
            `${d.symbol} | ${d.exDate} 주당 ${usd(d.currentDividendAmount, 6)} 배당 정보`,
            '',
            `• 배당락일: ${d.exDate}`,
            `• 배당락일 종가: ${usd(d.exDividendClose, 2)}`,
            `• 세전 배당금: ${usd(d.currentDividendAmount, 6)}`,
            `• 세후 배당금(15% 원천징수 가정): ${usd(d.afterTaxDividendAmount, 6)}`,
        ];
        if (pct(d.exDividendYield))
            lines.push(
                `• 주가 대비 세전 배당률: ${pct(d.exDividendYield)}`,
                `• 주가 대비 세후 배당률: ${pct(d.afterTaxDividendYield)}`
            );
        if (d.previousDividendAmount > 0)
            lines.push(
                '',
                `직전 배당 대비 ${d.dividendDifference >= 0 ? '+' : ''}${usd(d.dividendDifference, 6)} (${d.dividendChangePercent >= 0 ? '+' : ''}${pct(d.dividendChangePercent)})`
            );
        lines.push(
            '',
            '배당금은 운용사의 향후 공시에 따라 달라질 수 있습니다.',
            '* 주가 대비 배당률은 연환산 수익률이 아닌 해당 1회 배당금의 배당락일 종가 대비 비율입니다.',
            '* 투자 판단은 본인의 확인과 책임하에 진행해 주세요.'
        );
        return lines.join('\n');
    });
    const copy = async () => {
        if (!props.data.hasDividend) return;
        copyError.value = '';
        try {
            await navigator.clipboard.writeText(text.value);
            copied.value = true;
            window.setTimeout(() => (copied.value = false), 2000);
        } catch {
            copyError.value =
                '자동 복사를 사용할 수 없습니다. 위 문구를 직접 선택해 복사해 주세요.';
        }
    };
</script>
<template>
    <aside class="toss-copy">
        <p>TOSS COMMUNITY</p>
        <h2>{{ data.symbol }} 게시 문구</h2>
        <pre>{{ text }}</pre>
        <Message v-if="copyError" severity="warn" :closable="false">{{
            copyError
        }}</Message
        ><Button
            :label="copied ? '복사 완료' : '토스 게시 문구 복사'"
            :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
            :disabled="!data.hasDividend"
            @click="copy" />
    </aside>
</template>
<style scoped>
    .toss-copy {
        display: grid;
        gap: 16px;
        padding: 24px;
        border-radius: 16px;
        background: var(--app-surface);
        color: var(--app-text);
        border: 1px solid var(--app-border);
    }
    .toss-copy > p {
        margin: 0;
        color: var(--app-accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
    }
    .toss-copy h2 {
        margin: 0;
        font-size: 20px;
    }
    .toss-copy pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
        line-height: 1.8;
        color: var(--app-muted);
        margin: 0;
    }
    .toss-copy > .p-button {
        justify-self: start;
    }
</style>
