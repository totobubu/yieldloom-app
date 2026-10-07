<!-- src\App.vue -->
<script setup>
    import { computed, defineAsyncComponent } from 'vue';
    import { useHead } from '@vueuse/head';
    import ErrorBoundary from './components/ErrorBoundary.vue';
    import { isLegacyPortfolioEnabled } from '@/config/appMode';

    const LegacyLayout = defineAsyncComponent(
        () => import('./layouts/Layout.vue')
    );
    const ContentStudioLayout = defineAsyncComponent(
        () => import('./layouts/ContentStudioLayout.vue')
    );
    const activeLayout = computed(() =>
        isLegacyPortfolioEnabled ? LegacyLayout : ContentStudioLayout
    );

    useHead({
        // %s는 각 페이지 컴포넌트에서 설정한 title 값으로 대체됩니다.
        titleTemplate: '%s - 토토부부 배당 스튜디오',
    });
</script>

<template>
    <ErrorBoundary>
        <component :is="activeLayout" />
    </ErrorBoundary>
</template>
