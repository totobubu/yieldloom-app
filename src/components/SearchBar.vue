<!-- stock\src\components\SearchBar.vue -->
<template>
    <div class="p-4">
        <div class="flex gap-2">
            <InputText v-model="query" placeholder="검색어 입력" />
            <Button label="검색" @click="saveSearch" />
        </div>
    </div>
</template>

<script setup>
    import { ref } from 'vue';
    import { auth, db } from '../firebase';
    import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

    // PrimeVue 컴포넌트 import
    import InputText from 'primevue/inputtext';
    import Button from 'primevue/button';

    const query = ref('');

    const saveSearch = async () => {
        if (!auth.currentUser) {
            alert('로그인이 필요합니다.');
            return;
        }
        if (!query.value.trim()) return;

        try {
            await addDoc(collection(db, 'searchData'), {
                uid: auth.currentUser.uid,
                keyword: query.value.trim(),
                createdAt: serverTimestamp(),
            });
            alert('검색어 저장 완료');
            query.value = '';
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    };
</script>
