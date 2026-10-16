export function authDestination(raw, origin) {
    if (typeof raw !== 'string' || !raw.startsWith('/')) return '/mypage';
    try {
        const url = new URL(raw, origin);
        if (url.origin !== origin || url.pathname.startsWith('/login'))
            return '/mypage';
        return url.pathname + url.search + url.hash;
    } catch {
        return '/mypage';
    }
}

export function maskedEmail(value) {
    const [name, domain] = String(value).split('@');
    return name && domain
        ? `${name.slice(0, 2)}***@${domain}`
        : '입력한 이메일';
}
