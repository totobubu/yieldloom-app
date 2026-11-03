/* global document, location */
let pairing;
const status = document.querySelector('#status');
const flowId = new URLSearchParams(location.search).get('flow');
const enrollment = document.querySelector('#enroll');
async function request(path, input) {
    const result = await fetch(path, {
        method: 'POST',
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
            'X-Yieldloom-Pairing': pairing,
        },
        body: JSON.stringify(input),
    });
    if (!result.ok) throw Error();
    return result.json();
}
fetch('/session', { cache: 'no-store' })
    .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
    })
    .then(async (r) => {
        pairing = r.pairing;
        document.querySelector('#pairing').textContent = pairing;
        if (flowId) {
            const target = await request('/flow-info', { flowId });
            document.querySelector('#target').textContent =
                `${target.label || '선택 계좌'} · 끝 ${target.suffix} · 앱 계좌 ${target.accountId}`;
        }
    })
    .catch(() => {
        status.textContent = '이 PC의 로컬 주소로 다시 접속하세요.';
    });
document.querySelector('#unlock').addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = document.querySelector('#passphrase');
    const passphrase = field.value;
    field.value = '';
    try {
        await request('/unlock', { passphrase });
        enrollment.hidden = !flowId;
        status.textContent = flowId
            ? '저장소를 열었습니다. 아래 계좌 정보를 등록하세요.'
            : '저장소를 열었습니다. 웹앱에서 계좌 등록 페이지를 열어 주세요.';
    } catch {
        status.textContent =
            '저장소를 열지 못했습니다. 암호·파일 권한·다른 실행 프로그램을 확인하세요.';
    }
});
enrollment.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = ['clientId', 'clientSecret', 'accountNo'];
    const form = Object.fromEntries(
        fields.map((id) => [id, document.getElementById(id).value])
    );
    form.confirmed = document.querySelector('#confirmed').checked;
    form.replaceExisting = document.querySelector('#replaceExisting').checked;
    fields.forEach((id) => {
        document.getElementById(id).value = '';
    });
    try {
        await request('/enroll', { flowId, form });
        enrollment.hidden = true;
        status.textContent =
            '이 PC에 암호화해 등록했습니다. 웹앱으로 돌아가 등록 완료 확인을 눌러 주세요.';
    } catch {
        status.textContent =
            '등록하지 못했습니다. 계좌·중복 연결·서명 만료를 확인하고 웹앱에서 등록 페이지를 다시 여세요.';
    }
});
document.querySelector('#lock').addEventListener('click', async () => {
    try {
        await request('/lock', {});
        enrollment.hidden = true;
        status.textContent = '저장소를 잠갔습니다.';
    } catch {
        status.textContent =
            '잠금 요청을 확인하지 못했습니다. 프로그램을 종료하세요.';
    }
});
