<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import { useHead } from '@vueuse/head';
    import {
        browserLocalPersistence,
        browserSessionPersistence,
        confirmPasswordReset,
        sendPasswordResetEmail,
        setPersistence,
        signOut,
        signInWithEmailAndPassword,
        signInWithPopup,
        verifyPasswordResetCode,
    } from 'firebase/auth';
    import { useRoute, useRouter } from 'vue-router';
    import {
        auth,
        firebaseReady,
        firebaseUser,
        googleProvider,
    } from '@/services/firebaseClient';
    import { authDestination, maskedEmail } from '@/services/authForm';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import Checkbox from 'primevue/checkbox';
    import Divider from 'primevue/divider';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';
    import Password from 'primevue/password';

    const router = useRouter(),
        route = useRoute();
    const email = ref(''),
        password = ref(''),
        confirmation = ref('');
    const mode = ref('login'),
        busy = ref(false),
        googleBusy = ref(false),
        rememberMe = ref(true);
    const error = ref(''),
        emailTouched = ref(false),
        confirmationTouched = ref(false);
    const sentEmail = ref(''),
        verifiedEmail = ref(''),
        actionCode = ref(''),
        linkState = ref('idle');
    const resetReadyAt = ref(0),
        now = ref(Date.now());
    let cooldownTimer,
        verification = 0;
    const title = computed(
        () =>
            ({
                login: '로그인',
                reset: '비밀번호 재설정',
                confirm: '새 비밀번호 설정',
                complete: '비밀번호 변경 완료',
            })[mode.value]
    );
    useHead({ title });
    const destination = computed(() =>
        authDestination(route.query.redirect, window.location.origin)
    );
    const isPagesHost =
        window.location.origin === 'https://totobubu.github.io' &&
        window.location.pathname.startsWith('/yieldloom-app/');
    const webAppLogin = computed(() => {
        const url = new URL('/admin/login', 'https://yieldloom-app.vercel.app');
        url.searchParams.set('redirect', destination.value);
        if (actionCode.value) {
            url.searchParams.set('mode', 'resetPassword');
            url.searchParams.set('oobCode', actionCode.value);
        }
        return url.href;
    });
    const working = computed(() => busy.value || googleBusy.value);
    const emailInvalid = computed(
        () =>
            emailTouched.value &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())
    );
    const confirmationInvalid = computed(
        () => confirmationTouched.value && confirmation.value !== password.value
    );
    const newPassword = computed(() => mode.value === 'confirm');
    const resendRemaining = computed(() =>
        Math.max(0, Math.ceil((resetReadyAt.value - now.value) / 1000))
    );
    const showForm = computed(
        () =>
            mode.value !== 'complete' &&
            !(mode.value === 'reset' && sentEmail.value) &&
            (mode.value !== 'confirm' || linkState.value === 'ready')
    );

    watch(
        mode,
        (value, previous) => {
            error.value = '';
            password.value = '';
            confirmation.value = '';
            emailTouched.value = false;
            confirmationTouched.value = false;
            if (previous === 'confirm' && value !== 'confirm') {
                verification++;
                actionCode.value = '';
                router.replace({
                    path: '/admin/login',
                    query: route.query.redirect
                        ? { redirect: destination.value }
                        : {},
                });
            }
        },
        { flush: 'sync' }
    );

    function startCooldown() {
        clearInterval(cooldownTimer);
        now.value = Date.now();
        resetReadyAt.value = now.value + 60000;
        cooldownTimer = setInterval(() => {
            now.value = Date.now();
            if (now.value >= resetReadyAt.value) clearInterval(cooldownTimer);
        }, 1000);
    }

    async function verifyLink() {
        if (!firebaseReady || !actionCode.value) {
            linkState.value = 'invalid';
            return;
        }
        const sequence = ++verification;
        linkState.value = 'checking';
        error.value = '';
        try {
            const result = await verifyPasswordResetCode(
                auth,
                actionCode.value
            );
            if (sequence === verification && mode.value === 'confirm') {
                verifiedEmail.value = result;
                linkState.value = 'ready';
            }
        } catch (reason) {
            if (sequence !== verification || mode.value !== 'confirm') return;
            linkState.value = [
                'auth/expired-action-code',
                'auth/invalid-action-code',
            ].includes(reason.code)
                ? 'invalid'
                : 'retry';
            error.value =
                linkState.value === 'invalid'
                    ? '재설정 링크가 만료되었거나 이미 사용되었습니다. 새 안내 메일을 요청해 주세요.'
                    : '링크를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.';
        }
    }

    watch(
        () => route.query.oobCode,
        (code) => {
            if (route.query.mode !== 'resetPassword') return;
            if (typeof code !== 'string' || !code || code.length > 4096) {
                if (!actionCode.value) {
                    mode.value = 'confirm';
                    linkState.value = 'invalid';
                    error.value =
                        '올바른 재설정 링크가 필요합니다. 새 안내 메일을 요청해 주세요.';
                }
                return;
            }
            actionCode.value = code;
            mode.value = 'confirm';
            // Keep action codes out of subsequent referrers and browser history. They
            // remain only in this component's memory until completion or navigation.
            router.replace({
                path: '/admin/login',
                query: {
                    mode: 'resetPassword',
                    ...(route.query.redirect
                        ? { redirect: destination.value }
                        : {}),
                },
            });
            verifyLink();
        },
        { immediate: true }
    );
    onScopeDispose(() => {
        clearInterval(cooldownTimer);
        verification++;
        actionCode.value = '';
    });

    async function requestReset() {
        if (
            working.value ||
            !firebaseReady ||
            (email.value.trim() === sentEmail.value && resendRemaining.value)
        )
            return;
        emailTouched.value = true;
        if (emailInvalid.value) return;
        busy.value = true;
        error.value = '';
        try {
            try {
                await sendPasswordResetEmail(auth, email.value.trim());
            } catch (reason) {
                if (reason.code !== 'auth/user-not-found') throw reason;
            }
            // The same response is shown whether an address has an account or not.
            sentEmail.value = email.value.trim();
            startCooldown();
        } catch (reason) {
            error.value =
                reason.code === 'auth/too-many-requests'
                    ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
                    : '재설정 메일을 요청하지 못했습니다. 연결과 이메일 주소를 확인해 주세요.';
        } finally {
            busy.value = false;
        }
    }

    async function submit() {
        if (working.value || !firebaseReady) return;
        if (mode.value === 'reset') {
            await requestReset();
            return;
        }
        error.value = '';
        if (mode.value !== 'confirm') {
            emailTouched.value = true;
            if (emailInvalid.value) return;
        }
        if (
            newPassword.value &&
            (password.value.length < 6 || password.value !== confirmation.value)
        ) {
            confirmationTouched.value = true;
            error.value =
                password.value.length < 6
                    ? '비밀번호는 6자 이상 입력해 주세요.'
                    : '비밀번호가 일치하지 않습니다.';
            return;
        }
        busy.value = true;
        try {
            if (mode.value === 'confirm') {
                if (linkState.value !== 'ready' || !actionCode.value) return;
                await confirmPasswordReset(
                    auth,
                    actionCode.value,
                    password.value
                );
                email.value = verifiedEmail.value;
                mode.value = 'complete';
            } else {
                await setPersistence(
                    auth,
                    mode.value === 'login' && !rememberMe.value
                        ? browserSessionPersistence
                        : browserLocalPersistence
                );
                const credential = await signInWithEmailAndPassword(
                    auth,
                    email.value.trim(),
                    password.value
                );
                if (!isPortfolioAdmin(credential.user)) {
                    await signOut(auth);
                    error.value = '관리자 계정만 접근할 수 있습니다.';
                    return;
                }
                await router.push(destination.value);
            }
        } catch (reason) {
            if (
                mode.value === 'confirm' &&
                [
                    'auth/expired-action-code',
                    'auth/invalid-action-code',
                ].includes(reason.code)
            ) {
                linkState.value = 'invalid';
                error.value =
                    '재설정 링크가 만료되었거나 이미 사용되었습니다. 새 안내 메일을 요청해 주세요.';
            } else if (reason.code === 'auth/too-many-requests')
                error.value = '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
            else if (reason.code === 'auth/network-request-failed')
                error.value = '연결을 확인하고 다시 시도해 주세요.';
            else
                error.value =
                    mode.value === 'confirm'
                        ? '비밀번호를 변경하지 못했습니다. 비밀번호 조건을 확인하고 다시 시도해 주세요.'
                        : '로그인 정보를 확인해 주세요.';
        } finally {
            busy.value = false;
        }
    }
    async function google() {
        if (working.value || !firebaseReady) return;
        error.value = '';
        googleBusy.value = true;
        try {
            await setPersistence(
                auth,
                mode.value === 'login' && !rememberMe.value
                    ? browserSessionPersistence
                    : browserLocalPersistence
            );
            const credential = await signInWithPopup(auth, googleProvider);
            if (!isPortfolioAdmin(credential.user)) {
                await signOut(auth);
                error.value = '관리자 계정만 접근할 수 있습니다.';
                return;
            }
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
    function newRequest() {
        mode.value = 'reset';
        sentEmail.value = '';
        error.value = '';
    }
</script>

<template>
    <section class="auth-page">
        <div class="auth-banner">
            <span class="auth-banner-icon"
                ><i class="pi pi-wallet" aria-hidden="true"
            /></span>
            <div>
                <strong>내 기록을 한곳에서</strong>
                <p>업로드한 계좌 자료를 이어서 확인하세요.</p>
            </div>
            <i class="pi pi-lock" aria-hidden="true" />
        </div>
        <Card class="auth-card"
            ><template #content>
                <div class="auth-title">
                    <span class="auth-icon"
                        ><i
                            :class="
                                mode === 'complete'
                                    ? 'pi pi-check'
                                    : ['reset', 'confirm'].includes(mode)
                                      ? 'pi pi-key'
                                      : 'pi pi-user'
                            "
                            aria-hidden="true"
                    /></span>
                    <h1>{{ title }}</h1>
                    <p>
                        {{
                            mode === 'reset'
                                ? '가입할 때 사용한 이메일을 입력해 주세요.'
                                : mode === 'confirm'
                                  ? '이전과 다른 비밀번호로 계정을 다시 시작하세요.'
                                  : mode === 'complete'
                                    ? '새 비밀번호로 로그인할 수 있습니다.'
                                    : '관리자 계정으로 자산 관리 화면에 접근하세요.'
                        }}
                    </p>
                </div>
                <div v-if="!firebaseReady">
                    <Message
                        :severity="isPagesHost ? 'info' : 'warn'"
                        :closable="false"
                        >{{
                            isPagesHost
                                ? '계좌 관리와 로그인은 정식 웹앱에서 이용할 수 있어요. 아래 버튼으로 이동해 주세요.'
                                : '로그인 서비스에 연결할 수 없습니다. 잠시 후 다시 방문해 주세요.'
                        }}</Message
                    ><Button
                        v-if="isPagesHost"
                        as="a"
                        :href="webAppLogin"
                        label="웹앱에서 로그인"
                        icon="pi pi-arrow-up-right"
                        class="full-button" />
                </div>
                <template
                    v-else-if="
                        firebaseUser &&
                        !['reset', 'confirm', 'complete'].includes(mode)
                    "
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
                    <Message
                        v-if="error"
                        id="auth-error"
                        severity="error"
                        :closable="false"
                        role="alert"
                        >{{ error }}</Message
                    >
                    <div
                        v-if="mode === 'complete'"
                        class="auth-state"
                        role="status">
                        <i class="pi pi-check-circle" aria-hidden="true" />
                        <p>비밀번호 변경이 완료되었습니다.</p>
                        <small
                            >본인이 요청한 변경이 아니라면 계정 보안을 확인해
                            주세요.</small
                        >
                    </div>
                    <div
                        v-if="mode === 'confirm' && linkState === 'checking'"
                        class="auth-state"
                        role="status">
                        <i class="pi pi-spin pi-spinner" aria-hidden="true" />
                        <p>재설정 링크를 확인하고 있습니다.</p>
                    </div>
                    <div
                        v-if="
                            mode === 'confirm' &&
                            ['invalid', 'retry'].includes(linkState)
                        "
                        class="auth-state">
                        <Button
                            v-if="linkState === 'retry'"
                            label="링크 다시 확인"
                            @click="verifyLink" /><Button
                            label="새 재설정 메일 요청"
                            severity="secondary"
                            outlined
                            @click="newRequest" />
                    </div>
                    <div
                        v-if="mode === 'reset' && sentEmail"
                        class="auth-state reset-sent"
                        role="status">
                        <i class="pi pi-envelope" aria-hidden="true" />
                        <h2>메일함을 확인해 주세요</h2>
                        <p>
                            {{ maskedEmail(sentEmail) }} 주소로 요청을
                            접수했습니다. 계정이 있는 경우 재설정 안내가
                            발송됩니다.
                        </p>
                        <small
                            >메일이 보이지 않으면 스팸함을 확인해 주세요.
                            Google로 가입한 계정은 Google 로그인을 이용할 수
                            있습니다.</small
                        ><Button
                            :label="
                                resendRemaining
                                    ? `${resendRemaining}초 후 재전송 가능`
                                    : '재설정 메일 다시 요청'
                            "
                            :disabled="!!resendRemaining"
                            :loading="busy"
                            severity="secondary"
                            outlined
                            @click="requestReset" /><Button
                            label="다른 이메일 입력"
                            text
                            :disabled="working"
                            @click="
                                sentEmail = '';
                                error = '';
                            " />
                    </div>
                    <form v-if="showForm" @submit.prevent="submit">
                        <p v-if="mode === 'confirm'" class="verified-account">
                            {{ maskedEmail(verifiedEmail) }} 계정의 비밀번호를
                            변경합니다.
                        </p>
                        <div v-if="mode !== 'confirm'" class="studio-field">
                            <label for="auth-email">이메일</label
                            ><InputText
                                id="auth-email"
                                v-model="email"
                                type="email"
                                autocomplete="email"
                                placeholder="name@example.com"
                                required
                                fluid
                                :disabled="working"
                                :invalid="emailInvalid"
                                :aria-describedby="
                                    emailInvalid
                                        ? 'auth-email-error'
                                        : undefined
                                "
                                @blur="emailTouched = true" /><small
                                :style="{
                                    visibility: emailInvalid
                                        ? 'visible'
                                        : 'hidden',
                                }"
                                :aria-hidden="!emailInvalid"
                                id="auth-email-error"
                                class="field-error"
                                >이메일 주소 형식을 확인해 주세요.</small
                            >
                        </div>
                        <div v-if="mode !== 'reset'" class="studio-field">
                            <label for="auth-password">{{
                                mode === 'confirm' ? '새 비밀번호' : '비밀번호'
                            }}</label
                            ><Password
                                v-model="password"
                                input-id="auth-password"
                                :input-props="{
                                    required: true,
                                    minlength: newPassword ? 6 : undefined,
                                    autocomplete: newPassword
                                        ? 'new-password'
                                        : 'current-password',
                                    'aria-describedby': newPassword
                                        ? 'password-rule'
                                        : undefined,
                                }"
                                :feedback="false"
                                toggle-mask
                                fluid
                                :disabled="working"
                                placeholder="비밀번호 입력" /><small
                                v-if="newPassword"
                                id="password-rule"
                                class="password-rule"
                                :class="{ satisfied: password.length >= 6 }"
                                ><i
                                    :class="
                                        password.length >= 6
                                            ? 'pi pi-check-circle'
                                            : 'pi pi-circle'
                                    "
                                    aria-hidden="true" />6자 이상 입력해
                                주세요.</small
                            >
                        </div>
                        <div v-if="newPassword" class="studio-field">
                            <label for="auth-confirmation">비밀번호 확인</label
                            ><Password
                                v-model="confirmation"
                                input-id="auth-confirmation"
                                :input-props="{
                                    required: true,
                                    autocomplete: 'new-password',
                                    'aria-describedby': confirmationInvalid
                                        ? 'confirmation-error'
                                        : undefined,
                                }"
                                :invalid="confirmationInvalid"
                                :feedback="false"
                                toggle-mask
                                fluid
                                :disabled="working"
                                placeholder="비밀번호 다시 입력"
                                @blur="confirmationTouched = true" /><small
                                :style="{
                                    visibility: confirmationInvalid
                                        ? 'visible'
                                        : 'hidden',
                                }"
                                :aria-hidden="!confirmationInvalid"
                                id="confirmation-error"
                                class="field-error"
                                >비밀번호가 일치하지 않습니다.</small
                            >
                        </div>
                        <div v-if="mode === 'login'" class="auth-options">
                            <label for="remember-login"
                                ><Checkbox
                                    v-model="rememberMe"
                                    input-id="remember-login"
                                    binary
                                    :disabled="working" />로그인 상태
                                유지</label
                            ><Button
                                label="비밀번호를 잊으셨나요?"
                                class="reset-link"
                                text
                                severity="secondary"
                                :disabled="working"
                                @click="mode = 'reset'" />
                        </div>
                        <Button
                            :label="
                                mode === 'reset'
                                    ? '재설정 메일 요청'
                                    : mode === 'confirm'
                                      ? '새 비밀번호 저장'
                                      : title
                            "
                            type="submit"
                            fluid
                            :loading="busy"
                            :disabled="working" />
                    </form>
                    <template v-if="mode === 'login'"
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
                        ></template
                    >
                    <Button
                        v-else
                        label="로그인으로 돌아가기"
                        icon="pi pi-arrow-left"
                        text
                        severity="secondary"
                        class="full-button"
                        :disabled="working"
                        @click="mode = 'login'" />
                </template> </template
        ></Card>
        <div class="auth-guest">
            <i class="pi pi-info-circle" aria-hidden="true" />
            <p>로그인 없이도 주식·배당 정보를 둘러볼 수 있어요.</p>
            <router-link to="/"
                >주식 둘러보기<i class="pi pi-arrow-right" aria-hidden="true"
            /></router-link>
        </div>
        <nav class="auth-legal" aria-label="계정 이용 안내">
            <router-link to="/legal">이용 안내·개인정보 안내</router-link>
        </nav>
    </section>
</template>

<style scoped>
    .auth-page {
        max-width: 440px;
        margin: 36px auto 56px;
    }
    .auth-banner {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 16px;
        border-radius: 14px;
        margin-bottom: 16px;
        background: var(--app-surface-muted);
        font-size: 13px;
    }
    .auth-banner > div {
        flex: 1;
    }
    .auth-banner strong {
        color: var(--app-accent);
    }
    .auth-banner p {
        margin: 4px 0 0;
        color: var(--app-muted);
    }
    .auth-banner-icon {
        display: grid;
        place-items: center;
        border-radius: 50%;
        padding: 10px;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .auth-banner > i {
        color: var(--app-accent);
    }
    .auth-card {
        border: 1px solid var(--app-border);
        border-top: 3px solid var(--app-accent);
        box-shadow: 0 8px 28px #0f172a08;
    }
    .auth-card :deep(.p-card-body) {
        padding: 32px;
    }
    .auth-title {
        text-align: center;
        margin-bottom: 26px;
    }
    .auth-icon {
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        margin: auto;
        border-radius: 50%;
        color: var(--app-accent);
        background: var(--app-surface-muted);
        font-size: 22px;
    }
    .auth-title h1 {
        margin: 16px 0 8px;
        font-size: 26px;
    }
    .auth-title p {
        color: var(--app-muted);
        margin: 0;
        font-size: 14px;
        line-height: 1.7;
    }
    .auth-card form {
        display: grid;
        gap: 20px;
        margin-top: 20px;
    }
    .auth-options {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .auth-options label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--app-muted);
    }
    .reset-link {
        padding: 6px 0;
        font-size: 12px;
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
        font-size: 13px;
        margin: 18px 0 0;
    }
    .auth-switch :deep(.p-button) {
        padding-inline: 6px;
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
    .auth-guest {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px;
        margin-top: 16px;
        padding: 16px;
        text-align: center;
        border-radius: 12px;
        background: var(--app-surface-muted);
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.7;
    }
    .auth-guest p {
        margin: 0;
    }
    .auth-guest a {
        grid-column: 1 / -1;
        color: var(--app-accent);
        display: flex;
        justify-content: center;
        gap: 8px;
        align-items: center;
        margin-top: 6px;
    }
    .auth-legal {
        text-align: center;
        margin-top: 20px;
        font-size: 12px;
    }
    .auth-legal a {
        color: var(--app-muted);
    }
    .legal-note,
    .verified-account {
        margin: 0;
        font-size: 12px;
        line-height: 1.7;
        color: var(--app-muted);
    }
    .legal-note a {
        color: var(--app-accent);
    }
    .field-error {
        color: var(--p-red-600);
        font-size: 12px;
    }
    .password-rule {
        display: flex;
        gap: 6px;
        align-items: center;
        color: var(--app-muted);
        font-size: 12px;
    }
    .password-rule.satisfied {
        color: var(--app-accent);
    }
    .auth-state {
        display: grid;
        gap: 16px;
        text-align: center;
        margin: 20px 0;
    }
    .auth-state > i {
        font-size: 30px;
        color: var(--app-accent);
    }
    .auth-state h2 {
        margin: 0;
        font-size: 20px;
    }
    .auth-state p {
        margin: 0;
        line-height: 1.8;
        overflow-wrap: anywhere;
    }
    .auth-state small {
        color: var(--app-muted);
        line-height: 1.7;
    }
    @media (max-width: 600px) {
        .auth-page {
            margin: 12px auto 28px;
        }
        .auth-card :deep(.p-card-body) {
            padding: 24px 20px;
        }
        .auth-title {
            text-align: left;
        }
        .auth-icon {
            display: none;
        }
        .auth-title h1 {
            font-size: 24px;
            margin-top: 0;
        }
        .auth-options {
            flex-wrap: wrap;
        }
    }
</style>
