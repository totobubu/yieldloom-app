<script setup>
    import { computed } from 'vue';
    import { useRoute } from 'vue-router';
    import Button from 'primevue/button';
    defineEmits(['expand']);

    const props = defineProps({
        presentation: { type: String, default: 'tree' },
    });
    const route = useRoute();
    const links = [
        { label: '요약', query: { tab: 'overview', view: 'summary' } },
        { label: '보유 종목', query: { tab: 'overview', view: 'holdings' } },
        { label: '원금', query: { tab: 'overview', view: 'capital' } },
        { label: '캘린더', query: { tab: 'calendar' } },
        { label: '분석', query: { tab: 'insights' } },
        { label: '자산 관리', query: { tab: 'assets' } },
    ];
    const selected = computed(() => {
        if (route.path !== '/mypage') return '';
        const tab = route.query.tab || 'overview';
        return links.find(
            (link) =>
                link.query.tab === tab &&
                (tab !== 'overview' ||
                    link.query.view === (route.query.view || 'summary'))
        )?.label;
    });
</script>

<template>
    <nav
        class="portfolio-navigation"
        :class="{ 'section-navigation': props.presentation === 'sections' }"
        aria-label="포트폴리오 작업 공간">
        <div v-if="props.presentation === 'compact'" class="compact-navigation">
            <Button
                icon="pi pi-bars"
                aria-label="서브메뉴 펼치기"
                severity="secondary"
                text
                @click="$emit('expand')" />
            <span class="compact-divider" aria-hidden="true" />
            <span
                class="compact-current"
                :aria-label="`현재 위치: ${selected || '포트폴리오'}`"
                :title="`현재 위치: ${selected || '포트폴리오'}`"
                ><i class="pi pi-chart-pie" aria-hidden="true"
            /></span>
            <span class="compact-divider" aria-hidden="true" />
            <Button
                icon="pi pi-chevron-right"
                aria-label="서브메뉴 열기"
                severity="secondary"
                text
                @click="$emit('expand')" />
        </div>
        <div
            v-else-if="props.presentation === 'sections'"
            class="navigation-sections">
            <section>
                <h3>개요</h3>
                <router-link
                    v-for="link in links.slice(0, 3)"
                    :key="link.label"
                    :to="{ path: '/mypage', query: link.query }"
                    :class="{ selected: selected === link.label }"
                    :aria-current="selected === link.label ? 'page' : undefined"
                    >{{ link.label }}</router-link
                >
            </section>
            <section>
                <h3>캘린더</h3>
                <router-link to="/mypage?tab=calendar"
                    >월별 배당 일정</router-link
                ><router-link to="/mypage?tab=calendar&basis=ex"
                    >배당락일 캘린더</router-link
                >
            </section>
            <section>
                <h3>분석</h3>
                <router-link to="/mypage?tab=insights#asset-concentration"
                    >종목 집중도 (HHI)</router-link
                ><router-link to="/mypage?tab=insights#dividend-growth"
                    >배당 성장률</router-link
                >
            </section>
            <section>
                <h3>자산 관리</h3>
                <router-link to="/mypage?tab=assets">명의자 및 계좌</router-link
                ><router-link to="/mypage?tab=assets#manual-balance"
                    >수동 잔고 보정</router-link
                ><router-link
                    to="/mypage?tab=overview&view=capital#capital-details-heading"
                    >자금 입출금 흐름</router-link
                >
            </section>
        </div>
        <template v-else>
            <div class="workspace-heading">
                <span>내 작업 공간</span><span class="authorized">인증됨</span>
            </div>
            <div class="portfolio-group">
                <i class="pi pi-chart-pie" aria-hidden="true" />포트폴리오
            </div>
            <div class="portfolio-tree">
                <span class="overview-heading">개요</span>
                <router-link
                    v-for="(link, index) in links"
                    :key="link.label"
                    :to="{ path: '/mypage', query: link.query }"
                    :class="{
                        selected: selected === link.label,
                        'overview-link': index < 3,
                    }"
                    :aria-current="
                        selected === link.label ? 'page' : undefined
                    ">
                    {{ link.label }}
                    <i
                        v-if="selected === link.label"
                        class="pi pi-check"
                        aria-hidden="true" />
                </router-link>
            </div>
            <router-link class="simulator-link" to="/simulator"
                ><i class="pi pi-calculator" aria-hidden="true" />배당
                시뮬레이터</router-link
            >
            <p v-if="selected" class="selection-status">선택: {{ selected }}</p>
        </template>
    </nav>
</template>

<style scoped>
    .portfolio-navigation {
        color: var(--app-text);
        font-size: 12px;
    }
    .workspace-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px 16px;
        color: var(--app-muted);
        font-weight: 700;
    }
    .authorized {
        background: var(--app-warning-light);
        color: var(--app-warning-text);
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
    }
    .portfolio-group {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: var(--app-bg);
        border-radius: 8px;
        font-size: 14px;
        font-weight: 700;
    }
    .portfolio-group i {
        color: var(--app-accent);
    }
    .portfolio-tree {
        margin: 4px 4px 16px 14px;
        padding-left: 12px;
        border-left: 2px solid var(--app-border-subtle);
    }
    .overview-heading {
        display: block;
        padding: 6px 8px;
        font-weight: 600;
    }
    .portfolio-tree a {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        border-radius: 6px;
        margin-block: 2px;
        color: var(--app-muted);
        text-decoration: none;
    }
    .portfolio-tree .overview-link {
        margin-left: 8px;
    }
    .portfolio-tree a:hover {
        background: var(--app-surface-muted);
        color: var(--app-text);
    }
    .portfolio-tree a.selected {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        font-weight: 700;
    }
    .portfolio-tree i {
        font-size: 10px;
    }
    .simulator-link {
        display: flex;
        gap: 8px;
        padding: 12px 10px;
        border-top: 1px solid var(--app-border-subtle);
        color: var(--app-muted);
        text-decoration: none;
    }
    .selection-status {
        margin: 0;
        padding: 12px 8px 0;
        border-top: 1px solid var(--app-border-subtle);
        color: var(--app-muted);
        font-size: 11px;
    }

    .navigation-sections {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
    }
    .navigation-sections section {
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface);
    }
    .navigation-sections h3 {
        margin: 0 0 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--app-border-subtle);
        font-size: 12px;
        font-weight: 700;
    }
    .navigation-sections a {
        display: block;
        padding: 6px 10px;
        margin: 2px 0;
        border-radius: 6px;
        font-size: 12px;
        text-decoration: none;
        color: var(--app-muted);
    }
    .navigation-sections a.selected {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        font-weight: 700;
    }
    .compact-navigation {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
    }
    .compact-navigation :deep(.p-button),
    .compact-current {
        width: 36px;
        height: 36px;
        min-width: 36px;
        min-height: 36px;
        padding: 0;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .compact-current {
        background: var(--app-accent);
        color: white;
    }
    .compact-divider {
        width: 24px;
        height: 1px;
        background: var(--app-border);
    }
</style>
