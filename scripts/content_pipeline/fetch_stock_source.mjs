// A fixed-host transport shared by the Python issuer/reference collectors.
// No browser, cookies, API keys or user supplied arbitrary destinations.
import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
const allowed = new Set([
    'investor.bankofamerica.com',
    'newsroom.bankofamerica.com',
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
]);
const validate = (value) => {
    const url = new URL(value);
    if (
        url.protocol !== 'https:' ||
        !allowed.has(url.hostname) ||
        url.username ||
        url.password
    )
        throw Error('unsupported_source');
    return url;
};
let url = validate(input.url);
for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: {
            'User-Agent': 'Mozilla/5.0 (Yieldloom stock evidence collector)',
            Accept: 'text/html,application/json',
        },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
        url = validate(new URL(response.headers.get('location'), url));
        continue;
    }
    if (!response.ok) {
        console.log(
            JSON.stringify({
                error:
                    response.status === 429
                        ? 'rate_limited'
                        : response.status === 403
                          ? 'blocked'
                          : 'http_error',
                status: response.status,
            })
        );
        process.exit(0);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8 * 1024 * 1024) {
            await reader.cancel();
            throw Error('source_too_large');
        }
        chunks.push(value);
    }
    await new Promise((resolve, reject) => {
        process.stdout.write(
            JSON.stringify({
                url: url.href,
                content: Buffer.concat(chunks).toString('base64'),
            }) + '\n',
            (error) => (error ? reject(error) : resolve())
        );
    });
    process.exit(0);
}
throw Error('too_many_redirects');
