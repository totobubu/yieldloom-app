<!-- src\pages\MyPageView.vue -->
<script setup>
    import { ref, computed, onMounted, nextTick } from 'vue';
    import { useHead } from '@vueuse/head';

    import TabView from 'primevue/tabview';
    import TabPanel from 'primevue/tabpanel';

    import ProfileSettings from '@/components/mypage/ProfileSettings.vue';
    import BookmarkManager from '@/components/mypage/BookmarkManager.vue';
    import AssetManager from '@/components/mypage/AssetManager.vue';
    import { useAdmin } from '@/composables/asset/useAdmin';

    const activeTabIndex = ref(0);

    const { isAdmin } = useAdmin();

    const tabTitles = computed(() => {
        const baseTabs = ['북마크', '회원정보 수정'];
        return isAdmin.value
            ? ['북마크', '가족 자산 관리', '회원정보 수정']
            : baseTabs;
    });

    const pageTitle = computed(() => {
        const currentTabName =
            tabTitles.value[activeTabIndex.value] || '마이페이지';
        return `${currentTabName} | 마이페이지`;
    });

    useHead({
        title: pageTitle,
    });

    // 2. onMounted 훅을 추가합니다.
    onMounted(() => {
        // nextTick을 사용하여 Vue의 다음 DOM 업데이트 주기가 완료된 후 코드를 실행합니다.
        // 이렇게 하면 TabView 컴포넌트가 완전히 렌더링된 것을 보장할 수 있습니다.
        nextTick(() => {
            // 활성 탭 인덱스를 다시 0으로 설정하여 TabView가 상태를 갱신하고
            // .p-highlight 클래스를 올바르게 적용하도록 강제합니다.
            activeTabIndex.value = 0;
        });
    });
</script>

<template>
    <div id="t-mypage">
        <TabView v-model:activeIndex="activeTabIndex">
            <TabPanel header="북마크">
                <BookmarkManager />
            </TabPanel>
            <TabPanel v-if="isAdmin" header="가족 자산 관리">
                <AssetManager />
            </TabPanel>
            <TabPanel header="회원정보 수정">
                <ProfileSettings />
            </TabPanel>
        </TabView>
    </div>
</template>
