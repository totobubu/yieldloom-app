<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';

type Review = { id: number; ticker: string; ex_date: string; status: string; distribution_per_share: string; official_url: string; comparison_json: string; data_path: string | null };
type AuditRow = { ticker: string; status: string; path: string | null; rowCount: number; actualRowCount: number; expectedRowCount: number; forecastRowCount: number; placeholderRowCount: number; malformedRowCount: number; duplicateDateCount: number; earliestDate: string | null; latestDate: string | null; officialEventCount: number; matchedOfficialEventCount: number; conflictCount: number; pendingComparisonCount: number };
const reviews = ref<Review[]>([]); const summary = ref<Record<string, number>>({}); const error = ref('');
const reviewer = ref(''); const commandFeedback = ref('');
const statusFilter = ref('pending'); const tickerFilter = ref(''); const visibleLimit = ref(100);
const auditRows = ref<AuditRow[]>([]); const auditSummary = ref<Record<string, number>>({});
const auditFilter = ref('attention'); const auditVisibleLimit = ref(100);
const pending = computed(() => reviews.value.filter(row => !['matched', 'applied', 'rejected'].includes(row.status)));
const statuses = computed(() => Object.keys(summary.value).sort());
const filteredReviews = computed(() => reviews.value.filter((row) => {
  const matchesStatus = statusFilter.value === 'all' || (statusFilter.value === 'pending' ? !['matched', 'applied', 'rejected'].includes(row.status) : row.status === statusFilter.value);
  return matchesStatus && row.ticker.toLowerCase().includes(tickerFilter.value.trim().toLowerCase());
}));
const visibleReviews = computed(() => filteredReviews.value.slice(0, visibleLimit.value));
const auditStatuses = computed(() => Object.keys(auditSummary.value).sort());
const filteredAudit = computed(() => auditRows.value.filter((row) => {
  const safe = ['partially_verified'];
  const matchesStatus = auditFilter.value === 'all' || (auditFilter.value === 'attention' ? !safe.includes(row.status) : row.status === auditFilter.value);
  return matchesStatus && row.ticker.toLowerCase().includes(tickerFilter.value.trim().toLowerCase());
}));
const visibleAudit = computed(() => filteredAudit.value.slice(0, auditVisibleLimit.value));
function selectStatus(status: string) { statusFilter.value = status; visibleLimit.value = 100; }
function selectAuditStatus(status: string) { auditFilter.value = status; auditVisibleLimit.value = 100; }
function details(row: Review) { try { return JSON.parse(row.comparison_json) as { matchingFields?: string[]; legacy?: unknown[] }; } catch { return {}; } }
const powerShellQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
async function copyReviewCommand(row: Review, kind: 'approve' | 'reject') {
  if (!reviewer.value.trim()) { commandFeedback.value = '먼저 검토자 이름을 입력하세요.'; return; }
  let command = `python scripts/content_pipeline/reconcile_public_data.py --apply-review ${row.id} --reviewer ${powerShellQuote(reviewer.value.trim())} --action ${row.status === 'missing_date' ? 'append' : 'replace'}`;
  if (kind === 'reject') {
    const reason = window.prompt(`${row.ticker} 거절 사유를 입력하세요.`)?.trim();
    if (!reason) return;
    command = `python scripts/content_pipeline/reconcile_public_data.py --reject-review ${row.id} --reviewer ${powerShellQuote(reviewer.value.trim())} --reason ${powerShellQuote(reason)}`;
  }
  await navigator.clipboard.writeText(command);
  commandFeedback.value = `${row.ticker} ${kind === 'approve' ? '승인' : '거절'} 명령을 복사했습니다. 로컬에서 실행해야 반영됩니다.`;
}
async function load() { try { const response = await fetch('/content-studio/reconciliation.json', { cache: 'no-store' }); if (!response.ok) throw new Error(`스냅샷 없음 (${response.status})`); const payload = await response.json(); reviews.value = payload.reviews || []; summary.value = payload.summary || {}; auditRows.value = payload.legacyAudit?.tickers || []; auditSummary.value = payload.legacyAudit?.summary || {}; visibleLimit.value = 100; auditVisibleLimit.value = 100; } catch (reason) { error.value = reason instanceof Error ? reason.message : '불러오기 실패'; } }
onMounted(load);
</script>
<template>
  <section class="view"><header><div><p>CONTENT STUDIO ADMIN</p><h1>기존 데이터 대조·승인 대기</h1></div><button @click="load">새로고침</button></header>
    <p class="notice">SQLite 공식 원장과 <code>public/data</code>를 대조합니다. 공식 수집 티커의 JSON이 없으면 기존 신규 티커 워크플로를 먼저 실행합니다. 배당 행 자체는 이 화면에서 바꾸지 않으며 승인된 건만 로컬 CLI에서 반영합니다.</p>
    <p class="notice warning"><strong>판정 범위:</strong> <code>partially_verified</code>는 공식 이벤트와 일치한 행이 하나 이상 있다는 뜻일 뿐, 해당 파일의 전체 과거 이력이 검증됐다는 뜻은 아닙니다.</p>
    <p v-if="error" class="notice error">{{ error }}</p>
    <div class="review-actions"><InputText v-model="reviewer" aria-label="검토자 이름" placeholder="검토자 이름" /><span>원격에서 즉시 쓰지 않고, 감사 가능한 로컬 명령만 생성합니다.</span></div>
    <p v-if="commandFeedback" class="notice">{{ commandFeedback }}</p>
    <div class="filters" aria-label="대조 결과 필터"><Button label="승인 대기" size="small" :class="{ active: statusFilter === 'pending' }" @click="selectStatus('pending')" /><Button label="전체" size="small" :class="{ active: statusFilter === 'all' }" @click="selectStatus('all')" /><Button v-for="status in statuses" :key="status" :label="`${status} ${summary[status]}`" size="small" :class="{ active: statusFilter === status }" @click="selectStatus(status)" /></div>
    <div class="search"><InputText v-model="tickerFilter" aria-label="대조 티커 검색" placeholder="티커 검색" /><span>{{ filteredReviews.length.toLocaleString() }}건</span></div>
    <div class="table-wrap" v-if="visibleReviews.length"><table><thead><tr><th>티커</th><th>배당락일</th><th>공식 금액</th><th>대조 결과</th><th>일치 기준</th><th>공식 원문</th><th>검수 작업</th></tr></thead><tbody><tr v-for="row in visibleReviews" :key="row.id" :class="{ pending: pending.includes(row) }"><td>{{ row.ticker }}</td><td>{{ row.ex_date }}</td><td>{{ row.distribution_per_share }}</td><td><code>{{ row.status }}</code></td><td>{{ details(row).matchingFields?.join(', ') || '수동 검토' }}</td><td><a :href="row.official_url" target="_blank" rel="noreferrer">공식 원문</a></td><td><div v-if="pending.includes(row)" class="row-actions"><Button label="승인 명령" size="small" @click="copyReviewCommand(row, 'approve')" /><Button label="거절 명령" size="small" severity="danger" outlined @click="copyReviewCommand(row, 'reject')" /></div><span v-else>처리 완료</span></td></tr></tbody></table></div>
    <p v-else class="notice">표시할 기록이 없습니다.</p>
    <Button v-if="visibleReviews.length < filteredReviews.length" label="더 보기" severity="secondary" outlined @click="visibleLimit += 100" />
    <p class="command">승인: <code>python scripts/content_pipeline/reconcile_public_data.py --apply-review &lt;id&gt; --reviewer "name" --action append|replace</code></p>
    <header class="subhead"><div><p>LEGACY FILE AUDIT</p><h2>public/data 전체 파일 감사</h2></div><span>{{ auditRows.length.toLocaleString() }}개 티커</span></header>
    <div class="filters" aria-label="파일 감사 필터"><Button label="확인 필요" size="small" :class="{ active: auditFilter === 'attention' }" @click="selectAuditStatus('attention')" /><Button label="전체" size="small" :class="{ active: auditFilter === 'all' }" @click="selectAuditStatus('all')" /><Button v-for="status in auditStatuses" :key="status" :label="`${status} ${auditSummary[status]}`" size="small" :class="{ active: auditFilter === status }" @click="selectAuditStatus(status)" /></div>
    <div class="table-wrap" v-if="visibleAudit.length"><table><thead><tr><th>티커</th><th>감사 상태</th><th>전체 행</th><th>실제/예정/예측/빈행</th><th>공식 이벤트</th><th>일치/충돌/대기</th><th>기간</th></tr></thead><tbody><tr v-for="row in visibleAudit" :key="`${row.ticker}:${row.path}`"><td>{{ row.ticker }}</td><td><code>{{ row.status }}</code></td><td>{{ row.rowCount.toLocaleString() }}</td><td>{{ row.actualRowCount }} / {{ row.expectedRowCount }} / {{ row.forecastRowCount }} / {{ row.placeholderRowCount }}</td><td>{{ row.officialEventCount }}</td><td>{{ row.matchedOfficialEventCount }} / {{ row.conflictCount }} / {{ row.pendingComparisonCount }}</td><td>{{ row.earliestDate || '—' }} ~ {{ row.latestDate || '—' }}</td></tr></tbody></table></div>
    <p v-else class="notice">표시할 파일 감사 기록이 없습니다. 다음 대조 스냅샷 생성 후 확인하세요.</p>
    <Button v-if="visibleAudit.length < filteredAudit.length" label="파일 더 보기" severity="secondary" outlined @click="auditVisibleLimit += 100" />
  </section>
</template>
<style scoped>
.view{display:grid;gap:1rem}.view header{display:flex;justify-content:space-between;align-items:end;gap:1rem}.view header p{color:var(--studio-accent);font-weight:800;font-size:.75rem;letter-spacing:.1em;margin:0}.view h1,.view h2{margin:.2rem 0 0}.view header>button{border:1px solid var(--studio-border);background:var(--studio-surface);padding:.5rem .75rem;border-radius:.5rem;color:inherit}.subhead{margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--studio-border)}.subhead>span{color:var(--studio-muted)}.notice,.command{margin:0;padding:1rem;background:var(--studio-surface);border:1px solid var(--studio-border);border-radius:.75rem;color:var(--studio-muted)}.notice.warning{border-color:color-mix(in srgb,var(--studio-warning) 45%,var(--studio-border))}.error{color:var(--studio-danger)}.review-actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}.review-actions span{color:var(--studio-muted);font-size:.85rem}.filters,.row-actions{display:flex;gap:.45rem;flex-wrap:wrap}.filters :deep(.p-button.active){border-color:var(--studio-accent);color:var(--studio-accent)}.search{display:flex;align-items:center;justify-content:space-between;gap:1rem;color:var(--studio-muted)}.search :deep(.p-inputtext){width:min(22rem,100%)}.table-wrap{overflow:auto;border:1px solid var(--studio-border);border-radius:.75rem;background:var(--studio-surface)}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{padding:.7rem;border-bottom:1px solid var(--studio-border);text-align:left;white-space:nowrap}th{color:var(--studio-muted)}tr.pending td{background:color-mix(in srgb,var(--studio-warning) 8%,transparent)}a{color:var(--studio-accent)}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.8rem}@media(max-width:640px){.search{align-items:stretch;flex-direction:column}.search :deep(.p-inputtext){width:100%}}
</style>
