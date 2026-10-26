<script setup>
    import { computed } from 'vue';
    const props = defineProps({
        announcements: { type: Array, default: () => [] },
        result: { type: Object, default: null },
    });
    const latest = computed(() => props.announcements.slice(0, 4));
    const source = (row) =>
        /^https:\/\/(?:newsroom|investor)\.bankofamerica\.com\//.test(
            row.sourceUrl || ''
        )
            ? row.sourceUrl
            : null;
</script>
<template>
    <section
        v-if="latest.length || result"
        class="issuer-announcements"
        aria-label="기업 배당 공시">
        <header>
            <h2>기업 배당 공시</h2>
            <span>확인된 항목만 표시</span>
        </header>
        <p v-if="!latest.length">
            연결된 기업 공식 공시가 없습니다. 참고 배당은 공식 확정 이력과
            구분합니다.
        </p>
        <p v-else>
            공식 공시의 금액·날짜입니다. 배당락일이 미확인인 공시는 배당락일
            기준 이력에 합산하지 않습니다.
        </p>
        <article
            v-for="(row, index) in latest"
            :key="`${row.sourceUrl}:${index}`">
            <div class="issuer-amount">
                <strong
                    >{{ row.currency === 'USD' ? '$ ' : `${row.currency} `
                    }}{{ row.amountRaw }}</strong
                ><span>{{
                    row.verificationStatus === 'conflicting'
                        ? '정정 내용 검토 필요'
                        : '보통주 · 공식 공시'
                }}</span>
            </div>
            <dl>
                <div>
                    <dt>공시일</dt>
                    <dd>{{ row.declaredDate || '미확인' }}</dd>
                </div>
                <div>
                    <dt>배당락일</dt>
                    <dd>{{ row.exDate || '미확인' }}</dd>
                </div>
                <div>
                    <dt>기준일</dt>
                    <dd>{{ row.recordDate || '미확인' }}</dd>
                </div>
                <div>
                    <dt>지급일</dt>
                    <dd>{{ row.payableDate || '미확인' }}</dd>
                </div>
            </dl>
            <a
                v-if="source(row)"
                :href="source(row)"
                target="_blank"
                rel="noopener noreferrer"
                >기업 공식 원문
                <i class="pi pi-external-link" aria-hidden="true"
            /></a>
        </article>
        <p v-if="result?.status === 'failed'" role="status">
            이번 갱신에 실패해 이전 수집 자료를 표시합니다.
        </p>
        <p v-else-if="result">
            Yahoo Finance 시세·배당 참고 자료는 공식 공시와 구분합니다. 분할
            보정 기준이 미확인인 금액은 검토가 필요합니다.
        </p>
    </section>
</template>
<style scoped>
    .issuer-announcements {
        padding: 22px;
        margin: 18px 0;
        border: 1px solid var(--app-border);
        border-radius: 16px;
        background: var(--app-surface);
        color: var(--app-text);
    }
    header,
    .issuer-amount {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    h2 {
        font-size: 17px;
        margin: 0;
    }
    header span,
    p,
    dt,
    .issuer-amount span {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.6;
    }
    article {
        border-top: 1px solid var(--app-border);
        padding: 16px 0;
    }
    .issuer-amount strong {
        color: var(--app-accent);
        font-size: 20px;
    }
    dl {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
    }
    dd {
        margin: 4px 0 0;
        font-size: 14px;
    }
    a {
        color: var(--app-accent);
        font-size: 13px;
    }
    @media (max-width: 600px) {
        dl {
            grid-template-columns: repeat(2, 1fr);
        }
        .issuer-announcements {
            padding: 16px;
        }
    }
</style>
