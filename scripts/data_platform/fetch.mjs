// Node's native fetch matches the application's transport; no spoofed identity.
import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
    const { url, headers = {}, maxBytes = 12 * 1024 * 1024 } = JSON.parse(line);
    try {
        const initial = new URL(url);
        if (
            initial.protocol !== 'https:' ||
            initial.username ||
            initial.password
        )
            throw new Error('Only credential-free HTTPS sources are supported');
        let target = initial;
        let response;
        for (let hop = 0; hop <= 3; hop++) {
            response = await fetch(target, {
                headers,
                redirect: 'manual',
                signal: AbortSignal.timeout(25000),
            });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const next = new URL(response.headers.get('location'), target);
            await response.body?.cancel();
            if (next.origin !== initial.origin || hop === 3)
                throw new Error(
                    'Source redirect crossed its registered origin or limit'
                );
            target = next;
        }
        const chunks = [];
        let size = 0;
        if (response.body) {
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > maxBytes)
                    throw new Error('Source exceeds byte budget');
                chunks.push(chunk);
            }
        }
        console.log(
            JSON.stringify({
                status: response.status,
                content: Buffer.concat(chunks).toString('base64'),
                etag: response.headers.get('etag'),
                lastModified: response.headers.get('last-modified'),
            })
        );
    } catch (error) {
        console.log(JSON.stringify({ error: error.message }));
    }
}
