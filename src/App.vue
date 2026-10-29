<script setup>
import { useHead } from '@vueuse/head';
import ErrorBoundary from './components/ErrorBoundary.vue';
import ThumbnailLayout from './layouts/ThumbnailLayout.vue';
useHead({ titleTemplate: '%s - 모으멍 배당달력' });
</script>
<template><ErrorBoundary><ThumbnailLayout /></ErrorBoundary></template>
