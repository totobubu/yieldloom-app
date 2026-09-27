// src/store/auth.js

import { ref, watch } from 'vue';
import { auth, signOut } from '../firebase';
import router from '../router';
import { onAuthStateChanged } from 'firebase/auth';
import {
    useFilterState,
    loadMyBookmarksFromFirestore,
    saveMyBookmarksToFirestore,
} from '@/composables/portfolio/useFilterState';

export const user = ref(null);
export const isRecentlyAuthenticated = ref(false);

// [핵심] useFilterState에서 mainFilterTab을 가져옵니다.
const { myBookmarks, mainFilterTab } = useFilterState();

export const handleSignOut = async () => {
    await signOut(auth);
    await router.push({ name: 'login', query: { from: 'logout' } });
};

onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
        user.value = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
        };
        myBookmarks.value = await loadMyBookmarksFromFirestore(
            firebaseUser.uid
        );

        // [핵심 수정] 북마크 유무에 따라 기본 탭 설정
        if (Object.keys(myBookmarks.value).length > 0) {
            mainFilterTab.value = '북마크';
        } else {
            mainFilterTab.value = '미국';
        }
    } else {
        isRecentlyAuthenticated.value = false;
        user.value = null;
        myBookmarks.value = {};

        // [핵심 수정] 로그아웃 시 기본 탭을 '미국'으로 설정
        mainFilterTab.value = '미국';
    }
});

watch(
    myBookmarks,
    (newBookmarks) => {
        if (user.value) {
            saveMyBookmarksToFirestore(user.value.uid, newBookmarks);
        }
    },
    { deep: true }
);
