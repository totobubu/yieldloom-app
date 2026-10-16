<script setup>
    import { computed, ref, watch } from 'vue';
    import { useHead } from '@vueuse/head';
    import {
        createUserWithEmailAndPassword,
        sendPasswordResetEmail,
        signInWithEmailAndPassword,
        signInWithPopup,
    } from 'firebase/auth';
    import { useRoute, useRouter } from 'vue-router';
    import {
        auth,
        firebaseReady,
        firebaseUser,
        googleProvider,
    } from '@/services/firebaseClient';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import InputText from 'primevue/inputtext';
    import Password from 'primevue/password';
    import Message from 'primevue/message';
    import Divider from 'primevue/divider';

    const router = useRouter(),
        route = useRoute();
    const email = ref(''),
        password = ref(''),
        message = ref(''),
        error = ref('');
    const mode = ref('login'),
        busy = ref(false),
        googleBusy = ref(false);
    const title = computed(
        () =>
            ({ login: '로그인', signup: '회원가입', reset: '비밀번호 재설정' })[
                mode.value
            ]
    );
    useHead({ title });
    const destination = computed(() => {
        const redirect = route.query.redirect;
        return typeof redirect === 'string' &&
            redirect.startsWith('/') &&
            !redirect.startsWith('//') &&
            !redirect.startsWith('/login')
            ? redirect
            : '/mypage';
    });
    watch(mode, () => {
        error.value = '';
        message.value = '';
    });
    async function submit() {
        if (busy.value || googleBusy.value || !firebaseReady) return;
        error.value = '';
        message.value = '';
        busy.value = true;
        try {
            if (mode.value === 'reset') {
                await sendPasswordResetEmail(auth, email.value.trim());
                message.value =
                    '입력하신 이메일에서 비밀번호 재설정 안내를 확인해 주세요. 메일이 보이지 않으면 스팸함도 확인해 주세요.';
            } else {
                if (mode.value === 'signup')
                    await createUserWithEmailAndPassword(
                        auth,
                        email.value.trim(),
                        password.value
                    );
                else
                    await signInWithEmailAndPassword(
                        auth,
                        email.value.trim(),
                        password.value
                    );
                await router.push(destination.value);
            }
        } catch (reason) {
            if (reason.code === 'auth/too-many-requests')
                error.value = '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
            else if (reason.code === 'auth/network-request-failed')
                error.value = '연결을 확인하고 다시 시도해 주세요.';
            else
                error.value =
                    mode.value === 'reset'
                        ? '재설정 메일을 요청하지 못했습니다. 이메일을 확인해 주세요.'
                        : mode.value === 'signup'
                          ? '가입을 완료하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.'
                          : '로그인 정보를 확인해 주세요.';
        } finally {
            busy.value = false;
        }
    }
    async function google() {
        if (busy.value || googleBusy.value || !firebaseReady) return;
        error.value = '';
        googleBusy.value = true;
        try {
            await signInWithPopup(auth, googleProvider);
            await router.push(destination.value);
        } catch (reason) {
            error.value =
                reason.code === 'auth/popup-closed-by-user'
                    ? '로그인이 취소되었습니다. 다시 시도할 수 있어요.'
                    : 'Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.';
        } finally {
            googleBusy.value = false;
        }
    }
</script>

<template>
    <section class="auth-page">
        <aside class="auth-intro">
            <span class="studio-eyebrow">MY DIVIDEND JOURNEY</span>
            <h2>차곡차곡 쌓이는 배당,<br />한눈에 보이는 내 기록.</h2>
            <p>
                여러 계좌의 투자 기록을 정리하고<br />내 돈의 흐름을 확인해
                보세요.
            </p>
            <div class="intro-features">
                <div>
                    <i class="pi pi-wallet" aria-hidden="true" /><span
                        >내 계좌와 거래 기록을 한곳에</span
                    >
                </div>
                <div>
                    <i class="pi pi-chart-bar" aria-hidden="true" /><span
                        >자료를 바탕으로 살펴보는 원금 회수</span
                    >
                </div>
                <div>
                    <i class="pi pi-users" aria-hidden="true" /><span
                        >원하는 가족에게만 선택적으로 공유</span
                    >
                </div>
            </div>
            <router-link to="/"
                >로그인 없이 종목 둘러보기
                <i class="pi pi-arrow-right" aria-hidden="true"
            /></router-link>
        </aside>
        <Card class="auth-card"
            ><template #content>
                <div class="auth-title">
                    <span class="auth-icon"
                        ><i
                            :class="
                                mode === 'reset' ? 'pi pi-key' : 'pi pi-user'
                            "
                            aria-hidden="true"
                    /></span>
                    <h1>{{ title }}</h1>
                    <p>
                        {{
                            mode === 'reset'
                                ? '가입할 때 사용한 이메일을 입력해 주세요.'
                                : mode === 'signup'
                                  ? '내 배당 기록을 관리하는 첫걸음.'
                                  : '내 계좌와 배당 기록을 이어서 확인하세요.'
                        }}
                    </p>
                </div>
                <Message v-if="!firebaseReady" severity="warn" :closable="false"
                    >로그인 서비스에 연결할 수 없습니다. 잠시 후 다시 방문해
                    주세요.</Message
                >
                <template v-else-if="firebaseUser"
                    ><Message severity="success" :closable="false"
                        >{{ firebaseUser.email }}로 로그인되어
                        있습니다.</Message
                    ><Button
                        class="full-button"
                        label="내 포트폴리오로 이동"
                        icon="pi pi-arrow-right"
                        icon-pos="right"
                        @click="router.push(destination)"
                /></template>
                <template v-else>
                    <Message v-if="error" severity="error" :closable="false">{{
                        error
                    }}</Message>
                    <Message
                        v-if="message"
                        severity="success"
                        :closable="false"
                        >{{ message }}</Message
                    >
                    <form @submit.prevent="submit">
                        <div class="studio-field">
                            <label for="auth-email">이메일</label
                            ><InputText
                                id="auth-email"
                                v-model="email"
                                type="email"
                                autocomplete="email"
                                placeholder="name@example.com"
                                required
                                fluid
                                :disabled="busy || googleBusy" />
                        </div>
                        <div v-if="mode !== 'reset'" class="studio-field">
                            <label for="auth-password">비밀번호</label
                            ><Password
                                v-model="password"
                                input-id="auth-password"
                                :input-props="{
                                    required: true,
                                    minlength:
                                        mode === 'signup' ? 6 : undefined,
                                    autocomplete:
                                        mode === 'signup'
                                            ? 'new-password'
                                            : 'current-password',
                                }"
                                :feedback="false"
                                toggle-mask
                                fluid
                                :disabled="busy || googleBusy"
                                placeholder="비밀번호 입력" /><small
                                v-if="mode === 'signup'"
                                class="studio-muted"
                                >6자 이상 입력해 주세요.</small
                            >
                        </div>
                        <Button
                            v-if="mode === 'login'"
                            label="비밀번호를 잊으셨나요?"
                            class="reset-link"
                            text
                            severity="secondary"
                            :disabled="busy || googleBusy"
                            @click="mode = 'reset'" />
                        <Button
                            :label="
                                mode === 'reset' ? '재설정 메일 요청' : title
                            "
                            type="submit"
                            fluid
                            :loading="busy"
                            :disabled="googleBusy" />
                    </form>
                    <template v-if="mode !== 'reset'"
                        ><Divider align="center"
                            ><span class="studio-muted">또는</span></Divider
                        ><Button
                            class="google-button"
                            label="Google로 계속하기"
                            outlined
                            severity="secondary"
                            fluid
                            :loading="googleBusy"
                            :disabled="busy"
                            @click="google"
                            ><template #icon
                                ><span aria-hidden="true" class="google-mark"
                                    >G</span
                                ></template
                            ></Button
                        >
                        <p class="auth-switch">
                            {{
                                mode === 'signup'
                                    ? '이미 계정이 있나요?'
                                    : '처음 방문하셨나요?'
                            }}
                            <Button
                                :label="
                                    mode === 'signup' ? '로그인' : '회원가입'
                                "
                                text
                                :disabled="busy || googleBusy"
                                @click="
                                    mode =
                                        mode === 'signup' ? 'login' : 'signup'
                                " /></p
                    ></template>
                    <Button
                        v-else
                        label="로그인으로 돌아가기"
                        icon="pi pi-arrow-left"
                        text
                        severity="secondary"
                        class="full-button"
                        :disabled="busy"
                        @click="mode = 'login'" />
                </template>
                <router-link class="browse-link" to="/"
                    >로그인 없이 종목 둘러보기</router-link
                >
            </template></Card
        >
    </section>
</template>

<style scoped>
    .auth-page {
        max-width: 1040px;
        margin: 48px auto 64px;
        display: grid;
        grid-template-columns: 1fr 440px;
        align-items: center;
        gap: 72px;
    }
    .auth-intro h2 {
        font-size: 36px;
        line-height: 1.45;
        margin: 20px 0;
    }
    .auth-intro > p {
        color: var(--app-muted);
        font-size: 17px;
        line-height: 1.8;
    }
    .intro-features {
        display: grid;
        gap: 20px;
        margin: 36px 0;
    }
    .intro-features > div {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .intro-features i {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: var(--app-surface);
        color: var(--app-accent);
        border: 1px solid var(--app-border);
    }
    .auth-intro > a {
        color: var(--app-accent);
        font-size: 14px;
        text-decoration: none;
    }
    .auth-card {
        border: 1px solid var(--app-border);
    }
    .auth-card :deep(.p-card-body) {
        padding: 32px;
    }
    .auth-title {
        margin-bottom: 24px;
    }
    .auth-icon {
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        border-radius: 14px;
        color: var(--app-accent);
        background: var(--app-surface-muted);
        font-size: 20px;
    }
    .auth-title h1 {
        margin: 16px 0 8px;
        font-size: 28px;
    }
    .auth-title p {
        color: var(--app-muted);
        margin: 0;
        font-size: 14px;
    }
    .auth-card form {
        display: grid;
        gap: 20px;
        margin-top: 20px;
    }
    .reset-link {
        justify-self: end;
        margin-top: -12px;
        padding: 8px 0;
        font-size: 13px;
    }
    .auth-card :deep(.p-divider) {
        margin-block: 24px;
        font-size: 13px;
    }
    .auth-switch {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 4px;
        color: var(--app-muted);
        font-size: 14px;
        margin: 16px 0;
    }
    .auth-switch :deep(.p-button) {
        padding-inline: 8px;
    }
    .browse-link {
        display: block;
        text-align: center;
        color: var(--app-muted);
        font-size: 13px;
        margin-top: 20px;
    }
    .full-button {
        width: 100%;
        margin-top: 20px;
    }
    .google-mark {
        font-size: 20px;
        font-weight: 750;
        color: var(--app-accent);
    }
    .auth-card :deep(.p-message) {
        margin: 12px 0;
    }
    @media (max-width: 900px) {
        .auth-page {
            grid-template-columns: 1fr;
            max-width: 440px;
            margin: 16px auto 32px;
            gap: 0;
        }
        .auth-intro {
            display: none;
        }
    }
    @media (max-width: 480px) {
        .auth-card :deep(.p-card-body) {
            padding: 24px 20px;
        }
        .auth-title h1 {
            font-size: 26px;
        }
    }
</style>
