<script setup>
    import { defineAsyncComponent } from 'vue';
    import { useRoute } from 'vue-router';
    import FinalTossLedger from '@/components/portfolio/FinalTossLedger.vue';
    const route = useRoute();
    // Historical tools are explicit opt-in; no legacy fetch or comparisons in the final view.
    const SourceTools = defineAsyncComponent(
        () => import('./SheetLedgerSourceToolsView.vue')
    );
</script>
<template>
    <SourceTools v-if="route.query.view === 'source-tools'" />
    <FinalTossLedger v-else />
</template>
