<script setup>
    import { computed } from 'vue';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    const props = defineProps({
        health: { type: Object, default: () => ({}) },
        failures: { type: Array, default: () => [] },
    });
    const rows = computed(() =>
        Object.entries(props.health.providers || {}).map(
            ([provider, value]) => ({
                provider,
                ...value,
                stale:
                    !Number.isFinite(Date.parse(value.lastSuccessAt)) ||
                    Date.now() - Date.parse(value.lastSuccessAt) >
                        72 * 3600_000,
            })
        )
    );
    const labels = {
        failed: '수집 실패',
        degraded: '일부 확인 필요',
        healthy: '정상',
    };
</script>
<template>
    <details class="collection-health" open>
        <summary>운용사별 수집 상태</summary>
        <Message v-if="!rows.length" severity="info"
            >수집 시각 기록을 시작하기 전입니다. 조사 자료의 생성일은 성공
            시각으로 간주하지 않습니다.</Message
        >
        <div class="health-grid">
            <article v-for="row in rows" :key="row.provider">
                <h3>{{ row.provider }}</h3>
                <Tag
                    :value="
                        row.stale ? '성공 기록 지연·미확인' : labels[row.status]
                    "
                    :severity="
                        row.status === 'healthy' && !row.stale
                            ? 'success'
                            : 'warn'
                    " />
                <dl>
                    <dt>마지막 시도</dt>
                    <dd>{{ row.lastAttemptAt || '미확인' }}</dd>
                    <dt>마지막 성공</dt>
                    <dd>{{ row.lastSuccessAt || '미확인' }}</dd>
                    <dt>공식 연결 / 실패</dt>
                    <dd>
                        {{ row.verifiedLinks }}개 / {{ row.failureCount }}건
                    </dd>
                </dl>
                <p v-if="row.coverageDrop">
                    이전 정상 수집 대비 연결 수가 30% 이상 감소했습니다. 기존
                    데이터는 보존합니다.
                </p>
            </article>
        </div>
        <p>
            일부 실패 시 확인된 추가분만 반영하고 기존 정상 연결은 유지합니다.
            재수집은 다음 예약 작업 또는 아래 실행 화면에서 시작할 수 있습니다.
        </p>
        <a
            href="https://github.com/totobubu/yieldloom-app/actions/workflows/refresh-underlying-metadata.yml"
            target="_blank"
            rel="noopener noreferrer"
            >수집 작업 확인·재실행</a
        >
        <details v-if="failures.length">
            <summary>최근 실패 {{ failures.length }}건</summary>
            <ul>
                <li
                    v-for="(row, index) in failures"
                    :key="`${row.provider}-${row.symbol}-${index}`">
                    {{ row.provider }} {{ row.symbol || '' }} — {{ row.error }}
                </li>
            </ul>
        </details>
    </details>
</template>
<style scoped>
    .collection-health {
        margin: 20px 0;
        padding: 18px;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
        overflow-wrap: anywhere;
    }
    summary {
        cursor: pointer;
        font-weight: 700;
    }
    .health-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
    }
    .health-grid article {
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    dd {
        margin: 4px 0 10px;
        font-size: 12px;
    }
    dt {
        font-weight: 600;
    }
    ul {
        padding-left: 20px;
    }
</style>
