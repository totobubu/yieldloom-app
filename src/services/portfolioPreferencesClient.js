export function createPortfolioPreferencesClient({
    getUser,
    request,
    now = Date.now,
}) {
    let generation = 0;
    let user,
        value,
        expires = 0,
        pending;
    const reset = () => {
        generation++;
        user = undefined;
        value = undefined;
        pending = undefined;
        expires = 0;
    };
    function session() {
        const next = getUser();
        if (!next) {
            reset();
            throw new Error('로그인이 필요합니다.');
        }
        if (next !== user) {
            reset();
            user = next;
        }
        return next;
    }
    function check(expected, version) {
        if (
            getUser() !== expected ||
            user !== expected ||
            version !== generation
        )
            throw new DOMException('설정 조회가 취소되었습니다.', 'AbortError');
    }
    const remember = (result) => {
        const prefs = result?.preferences;
        if (
            !prefs ||
            typeof prefs.enabled !== 'boolean' ||
            typeof prefs.browser !== 'boolean' ||
            ![1, 3, 7].includes(prefs.leadDays) ||
            !Number.isSafeInteger(result.revision) ||
            result.revision < 0
        )
            throw new Error(
                '알림 설정 응답을 확인하지 못했습니다. 다시 조회하세요.'
            );
        value = Object.freeze({
            preferences: Object.freeze({ ...result.preferences }),
            revision: result.revision,
        });
        expires = now() + 300000;
        return value;
    };
    async function get({ force = false } = {}) {
        const current = session();
        if (pending) return pending;
        if (!force && value && expires > now()) return value;
        const version = generation;
        const task = request('', undefined, { view: 'preferences' })
            .then((result) => {
                check(current, version);
                return remember(result);
            })
            .finally(() => {
                if (pending === task) pending = undefined;
            });
        pending = task;
        return task;
    }
    async function save(preferences, revision) {
        const current = session();
        const version = ++generation;
        pending = undefined;
        value = undefined;
        expires = 0;
        const task = request('savePreferences', {
            preferences,
            expectedRevision: revision,
        })
            .then((result) => {
                check(current, version);
                return remember(result);
            })
            .finally(() => {
                if (pending === task) pending = undefined;
            });
        pending = task;
        return task;
    }
    return { get, save, clear: reset };
}
