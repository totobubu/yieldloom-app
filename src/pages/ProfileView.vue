<!-- src\pages\ProfileView.vue -->
<script setup>
    import { useHead } from '@vueuse/head';
    import ProfileSettings from '@/components/mypage/ProfileSettings.vue';

    useHead({ title: '회원정보 수정' });
</script>

<template>
    <ProfileSettings />
</template>
