<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { authLoading, firebaseUser } from '@/services/firebaseClient';
import { importTossStatement, loadPortfolioAssets } from '@/services/portfolio';
const router = useRouter(); const file = ref(null); const password = ref(''); const assets = ref([]); const message = ref(''); const error = ref(''); const loading = ref(false);
async function refresh() { if (firebaseUser.value) assets.value = await loadPortfolioAssets(firebaseUser.value.uid); }
watch([firebaseUser, authLoading], async ([user, loadingAuth]) => { if (loadingAuth) return; if (!user) router.replace('/login'); else await refresh(); }, { immediate: true });
const current = computed(() => assets.value.filter((item) => item.portfolioPriority === 'current'));
async function upload() { error.value=''; message.value=''; if (!file.value) return; loading.value=true; try { const result=await importTossStatement(firebaseUser.value,file.value,password.value); password.value=''; message.value=`${result.transactionCount}건을 저장했습니다.`; await refresh(); } catch (e) { error.value=e.message; } finally { loading.value=false; } }
</script>
<template><section class="mypage"><h1>마이페이지</h1><p>토스 거래내역서는 원본을 저장하지 않고 개인 거래 원장으로만 반영합니다.</p><form @submit.prevent="upload"><input type="file" accept="application/pdf" @change="file=$event.target.files?.[0] || null"><input v-model="password" type="password" placeholder="PDF 비밀번호"><button :disabled="loading">{{ loading ? '가져오는 중' : '토스 거래내역서 추가' }}</button></form><p v-if="message">{{ message }}</p><p v-if="error" class="error">{{ error }}</p><h2>현재 보유 {{ current.length }}종</h2><ul><li v-for="asset in current" :key="asset.id"><router-link :to="`/thumbnail/${asset.symbol}`">{{ asset.symbol }}</router-link></li></ul></section></template>
<style scoped>.mypage{max-width:760px;margin:30px auto}.mypage form{display:grid;gap:10px}.mypage input,.mypage button{padding:12px;font:inherit}.error{color:#b91c1c}</style>
