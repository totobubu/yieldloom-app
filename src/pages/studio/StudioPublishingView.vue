<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import { getAssetUrl } from '@/utils/dataUrl';

type Target = { id: string; channel: 'toss-community' | 'blog'; label: string; textFile: string; imageFile: string };
type Manifest = {
    eventId: number; ticker: string; exDate: string; verificationStatus: string; officialUrl?: string;
    publishing?: { status?: string; requiresApproval?: boolean; targets?: Target[] };
};
type Bundle = { manifest?: Manifest };
type QueueItem = Target & Pick<Manifest, 'eventId' | 'ticker' | 'exDate' | 'verificationStatus' | 'officialUrl'>;

const manifests = ref<Manifest[]>([]);
const error = ref('');
const channel = ref<'all' | Target['channel']>('all');
const preparing = ref<string | null>(null);
const notice = ref('');
const approved = ref<Record<string, boolean>>({});

const key = (item: Pick<QueueItem, 'eventId' | 'id'>) => `divgrow-publish-approval:${item.eventId}:${item.id}`;
const ready = (item: QueueItem) => item.verificationStatus === 'official' || item.verificationStatus === 'cross_checked';
const queue = computed<QueueItem[]>(() => manifests.value.flatMap((manifest) =>
    (manifest.publishing?.targets ?? []).map((target) => ({ ...target, ...manifest }))
).filter((item) => channel.value === 'all' || item.channel === channel.value)
 .sort((a, b) => b.exDate.localeCompare(a.exDate) || a.ticker.localeCompare(b.ticker)));

async function load() {
    error.value = '';
    try {
        const response = await fetch(getAssetUrl('content-studio/content.json'), { cache: 'no-store' });
        if (response.status === 404) { manifests.value = []; return; }
        if (!response.ok) throw new Error(`발행 패키지를 읽지 못했습니다 (${response.status})`);
        const payload = await response.json() as { bundles?: Bundle[] };
        manifests.value = (payload.bundles ?? []).map((bundle) => bundle.manifest)
            .filter((item): item is Manifest => typeof item?.eventId === 'number' && Array.isArray(item.publishing?.targets));
        approved.value = Object.fromEntries(queue.value.map((item) => [key(item), localStorage.getItem(key(item)) === 'approved']));
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '발행 패키지를 불러오지 못했습니다.';
    }
}

function assetUrl(item: QueueItem, file: string) { return getAssetUrl(`content-studio/renders/${item.eventId}/${file}`); }

async function copyDraft(item: QueueItem) {
    notice.value = '';
    preparing.value = key(item);
    try {
        const response = await fetch(assetUrl(item, item.textFile), { cache: 'no-store' });
        if (!response.ok) throw new Error('게시 문구를 찾지 못했습니다. 산출물을 다시 내보내세요.');
        await navigator.clipboard.writeText(await response.text());
        notice.value = `${item.ticker} ${item.label} 문구를 복사했습니다. 외부 게시 전 원문과 이미지를 다시 확인하세요.`;
    } catch (cause) {
        notice.value = cause instanceof Error ? cause.message : '문구 복사에 실패했습니다.';
    } finally { preparing.value = null; }
}

function setApproval(item: QueueItem) {
    const itemKey = key(item);
    const next = !approved.value[itemKey];
    approved.value = { ...approved.value, [itemKey]: next };
    if (next) localStorage.setItem(itemKey, 'approved'); else localStorage.removeItem(itemKey);
    notice.value = next
        ? `${item.ticker} ${item.label} 패키지를 승인했습니다. 이 승인은 이 브라우저에만 저장되며 게시를 실행하지 않습니다.`
        : `${item.ticker} ${item.label} 승인을 취소했습니다.`;
}

onMounted(load);
</script>

<template>
    <section class="view">
        <header>
            <div><p>REVIEW REQUIRED</p><h1>발행 대기열</h1><small>승인은 로컬 기록이며, 외부 서비스에 업로드하거나 게시하지 않습니다.</small></div>
            <Button label="새로고침" severity="secondary" @click="load" />
        </header>
        <p v-if="error" class="notice error">{{ error }}</p>
        <p v-if="notice" class="notice">{{ notice }}</p>
        <div class="filters" aria-label="채널 필터">
            <Button label="전체" size="small" :class="{ active: channel === 'all' }" @click="channel = 'all'" />
            <Button label="토스 커뮤니티" size="small" :class="{ active: channel === 'toss-community' }" @click="channel = 'toss-community'" />
            <Button label="블로그" size="small" :class="{ active: channel === 'blog' }" @click="channel = 'blog'" />
        </div>
        <p v-if="!queue.length" class="notice">발행 가능한 패키지가 없습니다. 최신 생성기와 내보내기 작업을 실행하세요.</p>
        <div v-else class="queue">
            <article v-for="item in queue" :key="key(item)" class="card">
                <div class="card-head"><div><span class="channel">{{ item.channel === 'toss-community' ? 'TOSS COMMUNITY' : 'BLOG' }}</span><h2>{{ item.ticker }} · {{ item.label }}</h2></div><span :class="['state', ready(item) ? 'verified' : 'blocked']">{{ ready(item) ? '검증됨' : '차단됨' }}</span></div>
                <dl><div><dt>배당락일</dt><dd>{{ item.exDate }}</dd></div><div><dt>승인 상태</dt><dd>{{ approved[key(item)] ? '승인됨' : '검토 대기' }}</dd></div></dl>
                <img :src="assetUrl(item, item.imageFile)" :alt="`${item.ticker} ${item.label} 이미지 미리보기`" />
                <a v-if="item.officialUrl" :href="item.officialUrl" target="_blank" rel="noreferrer">공식 원문 재확인</a>
                <div class="actions"><Button label="승인 토글" severity="secondary" outlined :disabled="!ready(item)" @click="setApproval(item)" /><Button label="문구 복사" :loading="preparing === key(item)" :disabled="!ready(item) || !approved[key(item)]" @click="copyDraft(item)" /></div>
                <small>문구 복사는 승인 후 가능하며, 자동 로그인·업로드·게시 기능은 포함하지 않습니다.</small>
            </article>
        </div>
    </section>
</template>

<style scoped>
.view{display:grid;gap:1rem}.view>header{display:flex;justify-content:space-between;align-items:end;gap:1rem}.view>header p{margin:0 0 .35rem;color:var(--studio-accent);font-size:.75rem;font-weight:800;letter-spacing:.1em}h1,h2{margin:0}small,.notice{color:var(--studio-muted)}.filters,.actions{display:flex;gap:.5rem;flex-wrap:wrap}.filters :deep(.active){border-color:var(--studio-accent);color:var(--studio-accent)}.notice{margin:0;padding:1rem;border:1px solid var(--studio-border);border-radius:.75rem;background:var(--studio-surface)}.error{color:var(--studio-danger)}.queue{display:grid;grid-template-columns:repeat(auto-fit,minmax(285px,1fr));gap:1rem}.card{display:grid;gap:.85rem;padding:1rem;border:1px solid var(--studio-border);border-radius:1rem;background:var(--studio-surface)}.card-head{display:flex;justify-content:space-between;gap:.75rem}.channel{color:var(--studio-accent);font-size:.7rem;font-weight:800;letter-spacing:.08em}.state{height:max-content;padding:.25rem .45rem;border-radius:999px;font-size:.75rem;font-weight:800}.verified{background:#dcfae6;color:#067647}.blocked{background:#fee4e2;color:#b42318}dl{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:0}dt{color:var(--studio-muted);font-size:.75rem}dd{margin:.15rem 0 0;font-weight:800}.card img{width:100%;aspect-ratio:1.9/1;object-fit:cover;border:1px solid var(--studio-border);border-radius:.6rem;background:var(--studio-surface-subtle)}a{color:var(--studio-accent);font-weight:800}.card small{font-size:.76rem}
</style>
