// Auth provider calls are stubbed: this test never sends mail or creates users.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.AUTH_UI_BASE_URL || 'http://127.0.0.1:5173';
const output = 'design-review/auth-stitch';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    await page.clock.install();
    const errors = [],
        externalAuthRequests = [];
    page.on('pageerror', (error) => {
        errors.push(error.message);
        console.log('pageerror:', error.message);
    });
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => {
        externalAuthRequests.push(route.request().url().split('?')[0]);
        return route.abort();
    });
    await page.addInitScript(() => {
        window.__authCalls = [];
        window.__authCase = {
            reset: 'unknown',
            signup: 'pending',
            login: 'invalid',
        };
    });
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import { ref, computed } from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref(null), authLoading=ref(false), signedIn=computed(()=>false); export const firebaseReady=true, auth={}, googleProvider={}, db=null;`,
        })
    );
    await page.route('**/node_modules/.vite/deps/firebase_auth.js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `
const record=(op, details={})=>window.__authCalls.push({op,...details});
export const browserLocalPersistence={type:'LOCAL'},browserSessionPersistence={type:'SESSION'};
export async function setPersistence(auth,value){record('persistence',{type:value.type});}
export async function signInWithEmailAndPassword(auth,email){record('login',{email});throw {code:'auth/invalid-credential'};}
export async function createUserWithEmailAndPassword(auth,email){record('signup',{email});if(window.__authCase.signup==='pending')await new Promise(resolve=>window.__finishSignup=resolve);return {user:{uid:'fixture'}};}
export async function signInWithPopup(){record('google');throw {code:'auth/popup-closed-by-user'};}
export async function sendPasswordResetEmail(auth,email){record('reset',{email});if(window.__authCase.reset==='unknown')throw {code:'auth/user-not-found'};if(window.__authCase.reset==='network')throw {code:'auth/network-request-failed'};}
export async function verifyPasswordResetCode(auth,code){record('verify');if(code.includes('expired'))throw {code:'auth/expired-action-code'};if(code.includes('network')&&!window.__authCase.linkRetry)throw {code:'auth/network-request-failed'};return 'resetmember@example.test';}
export async function confirmPasswordReset(){record('confirm');}
export async function signOut(){}
`,
        })
    );
    const count = (op) =>
        page.evaluate(
            (op) => window.__authCalls.filter((call) => call.op === op).length,
            op
        );
    const open = async (path = '/login') => {
        await page.goto(base + path);
        await page.locator('.auth-card').waitFor();
    };
    await open('/login?redirect=/legal');
    await page
        .getByLabel('이메일', { exact: true })
        .fill('member@example.test');
    await page.getByLabel('비밀번호', { exact: true }).fill('fixture-password');
    await page
        .getByRole('checkbox', { name: '로그인 상태 유지', exact: true })
        .uncheck();
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page
        .getByRole('alert')
        .getByText('로그인 정보를 확인해 주세요.', { exact: true })
        .waitFor();
    assert.equal(await count('login'), 1);
    assert.equal(
        await page.evaluate(
            () =>
                window.__authCalls.find((call) => call.op === 'persistence')
                    .type
        ),
        'SESSION'
    );
    await page
        .getByRole('button', { name: 'Google로 계속하기', exact: true })
        .click();
    await page
        .getByText('로그인이 취소되었습니다. 다시 시도할 수 있어요.', {
            exact: true,
        })
        .waitFor();
    await page
        .getByRole('button', { name: '비밀번호를 잊으셨나요?', exact: true })
        .click();
    await page
        .getByRole('button', { name: '재설정 메일 요청', exact: true })
        .click();
    await page
        .getByRole('heading', { name: '메일함을 확인해 주세요', exact: true })
        .waitFor();
    await page.getByText(/계정이 있는 경우 재설정 안내가 발송됩니다/).waitFor();
    assert.equal(await count('reset'), 1);
    assert.ok(
        await page
            .getByRole('button', { name: /초 후 재전송 가능/ })
            .isDisabled()
    );
    await page.clock.fastForward(61000);
    await page.evaluate(() => (window.__authCase.reset = 'success'));
    await page
        .getByRole('button', { name: '재설정 메일 다시 요청', exact: true })
        .click();
    assert.equal(await count('reset'), 2);
    await page.screenshot({
        path: `${output}/reset-request-success.png`,
        fullPage: true,
    });
    await page
        .getByRole('button', { name: '다른 이메일 입력', exact: true })
        .click();
    await page
        .getByLabel('이메일', { exact: true })
        .fill('another@example.test');
    await page.evaluate(() => (window.__authCase.reset = 'network'));
    await page
        .getByRole('button', { name: '재설정 메일 요청', exact: true })
        .click();
    await page.getByText(/재설정 메일을 요청하지 못했습니다/).waitFor();
    await page
        .getByRole('button', { name: '로그인으로 돌아가기', exact: true })
        .click();
    await page.getByRole('button', { name: '회원가입', exact: true }).click();
    await page.getByLabel('비밀번호', { exact: true }).fill('abc12345');
    await page.getByLabel('비밀번호 확인', { exact: true }).fill('different');
    await page.getByRole('button', { name: '회원가입', exact: true }).click();
    assert.equal(await count('signup'), 0);
    await page
        .locator('#auth-error')
        .getByText('비밀번호가 일치하지 않습니다.', { exact: true })
        .waitFor();
    await page.getByLabel('비밀번호 확인', { exact: true }).fill('abc12345');
    await page.getByRole('button', { name: '회원가입', exact: true }).click();
    await page.waitForFunction(
        () => typeof window.__finishSignup === 'function'
    );
    assert.ok(
        await page
            .getByRole('button', { name: '회원가입', exact: true })
            .isDisabled()
    );
    assert.ok(
        await page
            .getByRole('button', { name: '로그인', exact: true })
            .isDisabled()
    );
    assert.equal(await count('signup'), 1);
    await page.evaluate(() => window.__finishSignup());
    await page.waitForURL(/\/legal$/);

    await open('/login?mode=resetPassword&oobCode=valid-fixture-code');
    await page.getByLabel('새 비밀번호', { exact: true }).waitFor();
    assert.ok(!page.url().includes('oobCode'));
    await page.getByLabel('새 비밀번호', { exact: true }).fill('new-password');
    await page.getByLabel('비밀번호 확인', { exact: true }).fill('mismatch');
    await page
        .getByRole('button', { name: '새 비밀번호 저장', exact: true })
        .click();
    assert.equal(await count('confirm'), 0);
    await page
        .getByLabel('비밀번호 확인', { exact: true })
        .fill('new-password');
    await page
        .getByRole('button', { name: '새 비밀번호 저장', exact: true })
        .click();
    await page
        .getByRole('heading', { name: '비밀번호 변경 완료', exact: true })
        .waitFor();
    assert.equal(await count('confirm'), 1);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.ok(
        await page.evaluate(
            () =>
                !JSON.stringify(localStorage).includes('valid-fixture-code') &&
                !JSON.stringify(sessionStorage).includes('valid-fixture-code')
        )
    );
    await page.screenshot({
        path: `${output}/reset-password-complete.png`,
        fullPage: true,
    });
    await open('/login?mode=resetPassword&oobCode=expired-fixture-code');
    await page.getByText(/재설정 링크가 만료되었거나 이미 사용/).waitFor();
    assert.equal(
        await page.getByLabel('새 비밀번호', { exact: true }).count(),
        0
    );
    await page
        .getByRole('button', { name: '새 재설정 메일 요청', exact: true })
        .click();
    await page
        .getByRole('heading', { name: '비밀번호 재설정', exact: true })
        .waitFor();
    await open('/login?mode=resetPassword&oobCode=network-fixture-code');
    await page
        .getByRole('button', { name: '링크 다시 확인', exact: true })
        .waitFor();
    await page.evaluate(() => (window.__authCase.linkRetry = true));
    await page
        .getByRole('button', { name: '링크 다시 확인', exact: true })
        .click();
    await page.getByLabel('새 비밀번호', { exact: true }).waitFor();

    await open();
    const layouts = [];
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const mode of ['login', 'signup', 'reset']) {
            if (mode === 'signup')
                await page
                    .getByRole('button', { name: '회원가입', exact: true })
                    .click();
            if (mode === 'reset') {
                await page
                    .getByRole('button', { name: '로그인', exact: true })
                    .click();
                await page
                    .getByRole('button', {
                        name: '비밀번호를 잊으셨나요?',
                        exact: true,
                    })
                    .click();
            }
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                ),
                `${width}/${mode}`
            );
            await page.evaluate(() => {
                document.activeElement?.blur();
                window.scrollTo(0, 0);
            });
            await page.screenshot({
                path: `${output}/${width}-${mode}.png`,
                fullPage: true,
            });
            layouts.push({ width, mode });
        }
        await page
            .getByRole('button', { name: '로그인으로 돌아가기', exact: true })
            .click();
    }
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await page.screenshot({
        path: `${output}/360-login-dark.png`,
        fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(externalAuthRequests, []);
    await fs.writeFile(
        `${output}/verification.json`,
        JSON.stringify(
            {
                layouts,
                errors,
                externalAuthRequests,
                provider: 'stubbed; no mail or account creation',
            },
            null,
            2
        )
    );
    console.log(
        'PASS: session persistence, Google cancel, signup confirmation/pending/success, non-enumerating reset/cooldown, action-code verification/expiry/retry/confirm, 12 layouts'
    );
} finally {
    await browser.close();
}
