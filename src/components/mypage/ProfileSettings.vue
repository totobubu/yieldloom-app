<!-- /components\mypage\ProfileSettings.vue -->
<script setup>
    import { ref, onMounted, onUnmounted, computed } from 'vue';
    import { useRouter } from 'vue-router';
    import { auth, db } from '@/firebase'; // signOut은 직접 사용하지 않으므로 제거 가능
    import { isRecentlyAuthenticated, user } from '@/store/auth';
    import {
        updatePassword,
        deleteUser,
        EmailAuthProvider,
        reauthenticateWithCredential,
        GoogleAuthProvider,
        reauthenticateWithPopup,
    } from 'firebase/auth';
    import { doc, setDoc, deleteDoc } from 'firebase/firestore';

    import Card from 'primevue/card';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Password from 'primevue/password';
    import Dialog from 'primevue/dialog';
    import Message from 'primevue/message';
    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';
    import Divider from 'primevue/divider';
    import { useToast } from 'primevue/usetoast';
    import { useConfirm } from 'primevue/useconfirm';

    const router = useRouter();
    const toast = useToast();
    const confirm = useConfirm();

    const displayName = ref('');
    const currentPassword = ref('');
    const newPassword = ref('');

    const isLoading = ref({
        auth: false,
        google: false,
        displayName: false,
        password: false,
        reset: false,
        delete: false,
    });

    const authError = ref('');

    const isDeleteConfirmDialogVisible = ref(false);
    const deleteConfirmPassword = ref('');

    onMounted(() => {
        displayName.value = user.value?.displayName || '';
        isRecentlyAuthenticated.value = false;
    });

    onUnmounted(() => {
        isRecentlyAuthenticated.value = false;
    });

    const usesPasswordProvider = computed(() => {
        return (
            !!user.value &&
            !!auth.currentUser?.providerData?.some(
                (provider) => provider.providerId === 'password'
            )
        );
    });

    const usesGoogleProvider = computed(() => {
        return (
            !!user.value &&
            !!auth.currentUser?.providerData?.some(
                (provider) => provider.providerId === 'google.com'
            )
        );
    });

    const handleReauth = async () => {
        if (!usesPasswordProvider.value) {
            authError.value = '이 계정은 비밀번호 인증을 지원하지 않습니다.';
            return;
        }
        if (!currentPassword.value) {
            authError.value = '비밀번호를 입력해주세요.';
            return;
        }
        authError.value = '';
        isLoading.value.auth = true;
        const credential = EmailAuthProvider.credential(
            user.value.email,
            currentPassword.value
        );
        try {
            await reauthenticateWithCredential(auth.currentUser, credential);
            isRecentlyAuthenticated.value = true;
            authError.value = '';
        } catch (error) {
            authError.value = '비밀번호가 올바르지 않습니다.';
        } finally {
            isLoading.value.auth = false;
            currentPassword.value = '';
        }
    };

    const handleGoogleReauth = async () => {
        if (!usesGoogleProvider.value) {
            authError.value = '구글 인증이 연결된 계정이 아닙니다.';
            return;
        }

        authError.value = '';
        isLoading.value.google = true;
        try {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            await reauthenticateWithPopup(auth.currentUser, provider);
            isRecentlyAuthenticated.value = true;
            authError.value = '';
        } catch (error) {
            if (error?.code === 'auth/popup-closed-by-user') {
                authError.value = '인증이 취소되었습니다. 다시 시도해주세요.';
            } else if (error?.code === 'auth/user-mismatch') {
                authError.value =
                    '현재 로그인한 계정과 다른 구글 계정입니다. 동일한 계정으로 인증해주세요.';
            } else {
                console.error('Google reauth error:', error);
                authError.value =
                    '구글 인증에 실패했습니다. 잠시 후 다시 시도해주세요.';
            }
        } finally {
            isLoading.value.google = false;
        }
    };

    const performUpdatePassword = async () => {
        if (!newPassword.value || newPassword.value.length < 6) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '새 비밀번호는 6자 이상이어야 합니다.',
                life: 3000,
            });
            return;
        }
        isLoading.value.password = true;
        try {
            await updatePassword(auth.currentUser, newPassword.value);
            toast.add({
                severity: 'success',
                summary: '성공',
                detail: '비밀번호가 변경되었습니다.',
                life: 3000,
            });
            newPassword.value = '';
        } catch (error) {
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '비밀번호 변경에 실패했습니다.',
                life: 3000,
            });
        } finally {
            isLoading.value.password = false;
        }
    };

    const handleResetBookmarks = () => {
        confirm.require({
            message:
                '모든 북마크를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
            header: '북마크 초기화',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: '삭제',
            rejectLabel: '취소',
            accept: async () => {
                isLoading.value.reset = true;
                try {
                    const userDocRef = doc(db, 'userBookmarks', user.value.uid);
                    await setDoc(userDocRef, { bookmarks: {} });
                    toast.add({
                        severity: 'info',
                        summary: '완료',
                        detail: '모든 북마크가 삭제되었습니다.',
                        life: 3000,
                    });
                } catch (error) {
                    toast.add({
                        severity: 'error',
                        summary: '오류',
                        detail: '초기화에 실패했습니다.',
                        life: 3000,
                    });
                } finally {
                    isLoading.value.reset = false;
                }
            },
        });
    };

    const handleDeleteUserRequest = () => {
        isDeleteConfirmDialogVisible.value = true;
        deleteConfirmPassword.value = '';
    };

    // --- [수정된 함수] ---
    const performDeleteUser = async () => {
        const credential = EmailAuthProvider.credential(
            user.value.email,
            deleteConfirmPassword.value
        );
        isLoading.value.delete = true;
        try {
            await reauthenticateWithCredential(auth.currentUser, credential);

            const userId = user.value.uid;
            const userDocRef = doc(db, 'userBookmarks', userId);
            await deleteDoc(userDocRef);
            await deleteUser(auth.currentUser);

            isDeleteConfirmDialogVisible.value = false;

            // [핵심 추가] 탈퇴 성공 후 홈으로 라우팅
            // onAuthStateChanged가 user 상태를 null로 바꾸기 전에 페이지를 이동시킴
            router.push('/');

            toast.add({
                severity: 'success',
                summary: '회원 탈퇴',
                detail: '정상적으로 탈퇴 처리되었습니다.',
                life: 3000,
            });
        } catch (error) {
            toast.add({
                severity: 'error',
                summary: '인증 실패',
                detail: '비밀번호가 올바르지 않습니다.',
                life: 3000,
            });
        } finally {
            isLoading.value.delete = false;
        }
    };
</script>

<template>
    <div id="t-profile-settings">
        <Card>
            <template #header>
                <div class="flex flex-col justify-content-center">
                    <Button
                        class="t-auth-icon"
                        icon="pi pi-user"
                        severity="secondary"
                        rounded
                        disabled
                        aria-label="unlock" />
                </div>
            </template>
            <template #content>
                <div class="flex flex-column gap-3">
                    <InputGroup>
                        <InputGroupAddon>@</InputGroupAddon>
                        <InputText
                            type="email"
                            :value="user?.email"
                            disabled
                            class="flex-grow" />
                    </InputGroup>

                    <div v-if="!isRecentlyAuthenticated">
                        <div class="flex flex-column gap-3">
                            <div
                                v-if="usesPasswordProvider"
                                class="flex flex-column gap-3">
                                <InputGroup>
                                    <InputGroupAddon>
                                        <i class="pi pi-key" />
                                    </InputGroupAddon>
                                    <Password
                                        v-model="currentPassword"
                                        placeholder="현재 비밀번호"
                                        :feedback="false"
                                        toggleMask
                                        @keyup.enter="handleReauth" />
                                    <InputGroupAddon>
                                        <Button
                                            label="인증"
                                            @click="handleReauth"
                                            :loading="isLoading.auth" />
                                    </InputGroupAddon>
                                </InputGroup>
                            </div>

                            <div
                                v-if="usesGoogleProvider"
                                class="flex flex-column gap-2">
                                <Button
                                    label="구글 계정으로 인증"
                                    icon="pi pi-google"
                                    severity="info"
                                    @click="handleGoogleReauth"
                                    :loading="isLoading.google" />
                                <small class="text-sm">
                                    구글 로그인으로 가입한 계정은 위 버튼을
                                    사용해 인증을 완료해주세요.
                                </small>
                            </div>

                            <Message
                                v-if="authError"
                                severity="error"
                                :closable="false"
                                >{{ authError }}</Message
                            >
                            <Message severity="info" :closable="false">
                                정보 변경 및 탈퇴를 위해 최근 인증이 필요합니다.
                            </Message>
                        </div>
                    </div>

                    <div v-else class="flex flex-column gap-3">
                        <Message severity="success" :closable="false"
                            >인증되었습니다. 이제 정보를 변경할 수
                            있습니다.</Message
                        >
                        <Divider />

                        <InputGroup>
                            <InputGroupAddon
                                ><i class="pi pi-key"></i
                            ></InputGroupAddon>
                            <Password
                                v-model="newPassword"
                                placeholder="새 비밀번호 (6자 이상)"
                                :feedback="false"
                                toggleMask />
                            <InputGroupAddon>
                                <Button
                                    label="변경"
                                    @click="performUpdatePassword"
                                    :loading="isLoading.password" />
                            </InputGroupAddon>
                        </InputGroup>

                        <Card class="border-red-500 border-2">
                            <template #content>
                                <div class="flex flex-column gap-2">
                                    <div
                                        class="flex flex-col gap-2 align-items-center">
                                        <span style="width: 10rem">
                                            <Button
                                                label="북마크 초기화"
                                                severity="danger"
                                                size="small"
                                                @click="handleResetBookmarks"
                                                class="w-full"
                                                :loading="isLoading.reset" />
                                        </span>
                                        <p class="text-sm">
                                            모든 데이터를 영구적으로 초기화
                                            합니다.
                                        </p>
                                    </div>
                                    <hr class="border-red-500 my-2" />
                                    <div
                                        class="flex flex-col gap-2 align-items-center">
                                        <span style="width: 10rem">
                                            <Button
                                                label="회원 탈퇴"
                                                severity="danger"
                                                size="small"
                                                @click="handleDeleteUserRequest"
                                                class="w-full"
                                                :loading="isLoading.delete" />
                                        </span>
                                        <p class="text-sm">
                                            계정과 모든 데이터를 삭제합니다.
                                        </p>
                                    </div>
                                </div>
                            </template>
                        </Card>
                    </div>
                </div>
            </template>
        </Card>

        <Dialog
            v-model:visible="isDeleteConfirmDialogVisible"
            modal
            header="회원 탈퇴"
            :style="{ width: '25rem' }">
            <p class="mb-4">
                정말로 탈퇴하시겠습니까? 계정을 보호하기 위해 비밀번호를 다시
                한번 입력해주세요.
            </p>
            <InputGroup>
                <InputGroupAddon><i class="pi pi-key"></i></InputGroupAddon>
                <Password
                    v-model="deleteConfirmPassword"
                    placeholder="현재 비밀번호"
                    class="w-full"
                    :feedback="false"
                    toggleMask
                    @keyup.enter="performDeleteUser" />
            </InputGroup>
            <template #footer>
                <Button
                    label="취소"
                    severity="secondary"
                    @click="isDeleteConfirmDialogVisible = false" />
                <Button
                    label="탈퇴 확인"
                    severity="danger"
                    @click="performDeleteUser"
                    :loading="isLoading.delete" />
            </template>
        </Dialog>
    </div>
</template>
