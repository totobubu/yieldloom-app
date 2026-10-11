<script setup>
import { useHead } from '@vueuse/head';
import ErrorBoundary from './components/ErrorBoundary.vue';
import ThumbnailLayout from './layouts/ThumbnailLayout.vue';
useHead({ titleTemplate: '%s - 토토부부 배당 스튜디오' });
</script>
<template><ErrorBoundary><ThumbnailLayout /></ErrorBoundary></template>
