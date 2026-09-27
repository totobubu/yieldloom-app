<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';
    import { useRoute } from 'vue-router';
    const route = useRoute();
    const kind = computed(() => String(route.meta.kind || 'content'));
    const labels: Record<string, string> = { distributions: '배당 이력', content: '콘텐츠 Bundle', sources: '공급자 소스 상태', reconciliation: '기존 데이터 대조·승인 대기', renders: '산출물', archive: '발행 아카이브' };
    const data = ref<Record<string, unknown>>({}); const error = ref('');
    const rows = computed<Record<string, unknown>[]>(() => {
        const values = Object.values(data.value); return (values.find(Array.isArray) as Record<string, unknown>[] | undefined) || [];
    });
    const columns = computed(() => Array.from(new Set(rows.value.flatMap(row => Object.keys(row)))).filter(key => !['files', 'manifest'].includes(key)).slice(0, 12));
    async function load() { try { const r = await fetch(`/content-studio/${kind.value}.json`, { cache: 'no-store' }); if (!r.ok) throw new Error(`스냅샷 없음 (${r.status})`); data.value = await r.json(); } catch (e) { error.value = e instanceof Error ? e.message : '불러오기 실패'; } }
    onMounted(load);
</script>
<template>
    <section class="view"><header><p>CONTENT STUDIO ADMIN</p><h1>{{ labels[kind] }}</h1><button @click="load">새로고침</button></header>
        <p v-if="error" class="notice">{{ error }} — 운영 파이프라인을 실행하면 갱신됩니다.</p>
        <p v-if="kind === 'distributions'" class="notice">NAV·가격 결합은 별도 공식 시장데이터 어댑터가 연결되기 전까지 미구성입니다. 표시 수치는 SQLite 공식 원장 기준입니다.</p>
        <p v-if="kind === 'reconciliation'" class="notice">이 화면은 비교 결과만 표시합니다. public/data 변경은 자동으로 수행하지 않으며, 승인자와 append·replace 작업을 지정한 CLI에서만 반영됩니다.</p>
        <div class="table-wrap" v-if="rows.length"><table><thead><tr><th v-for="column in columns" :key="column">{{ column }}</th><th v-if="kind === 'renders'">download</th></tr></thead><tbody><tr v-for="(row, index) in rows" :key="index"><td v-for="column in columns" :key="column"><template v-if="column === 'official_url'"><a :href="String(row[column])" target="_blank" rel="noreferrer">공식 원문</a></template><template v-else>{{ typeof row[column] === 'object' ? JSON.stringify(row[column]) : row[column] }}</template></td><td v-if="kind === 'renders'"><a :href="String(row.url)" download>다운로드</a></td></tr></tbody></table></div>
        <p v-else class="notice">표시할 기록이 없습니다.</p>
    </section>
</template>
<style scoped>
.view{display:grid;gap:1rem}.view header{display:flex;gap:1rem;align-items:end}.view header p{color:var(--studio-accent);font-weight:800;font-size:.75rem;letter-spacing:.1em;margin:0}.view h1{margin:0 auto 0 0}.view button{border:1px solid var(--studio-border);background:var(--studio-surface);padding:.5rem .75rem;border-radius:.5rem;color:inherit}.notice{margin:0;padding:1rem;background:var(--studio-surface);border:1px solid var(--studio-border);border-radius:.75rem;color:var(--studio-muted)}.table-wrap{overflow:auto;border:1px solid var(--studio-border);border-radius:.75rem;background:var(--studio-surface)}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{padding:.7rem;border-bottom:1px solid var(--studio-border);text-align:left;white-space:nowrap}th{color:var(--studio-muted)}a{color:var(--studio-accent)}
</style>
