// Accept complete JSON and older dashboard entries containing just JSON fields.
// Never include credential text in parsing errors.
export function parseFirebaseCredential(value) {
    const raw = String(value || '').trim();
    let parsed;
    for (const candidate of [
        raw,
        ...(raw.startsWith('"type"') ? [`{${raw}}`] : []),
    ]) {
        try {
            parsed = JSON.parse(candidate);
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            if (
                parsed &&
                ['project_id', 'client_email', 'private_key'].every(
                    (key) => typeof parsed[key] === 'string' && parsed[key]
                )
            )
                return parsed;
        } catch {
            /* Try the supported legacy representation. */
        }
    }
    throw new Error('Firebase 관리자 키의 JSON 형식을 확인해 주세요.');
}
