import assert from 'node:assert/strict';
import { createApiHandler } from '../lib/api-handler.js';

const previous = {
    origins: process.env.PUBLIC_APP_ORIGINS,
    vercel: process.env.VERCEL,
};
try {
    process.env.VERCEL = '1';
    process.env.PUBLIC_APP_ORIGINS = 'https://configured.example';
    const handler = createApiHandler(async (_req, res) =>
        res.status(200).json({ ok: true })
    );
    for (const [origin, allowed] of [
        ['https://totobubu.github.io', true],
        ['https://configured.example', true],
        ['https://unrelated.example', false],
        ['https://totobubu.github.io.unrelated.example', false],
    ]) {
        for (const method of ['GET', 'OPTIONS']) {
            const headers = {};
            const response = {
                setHeader: (name, value) => {
                    headers[name] = value;
                },
                status() {
                    return this;
                },
                json() {},
                end() {},
            };
            await handler({ method, headers: { origin } }, response);
            assert.equal(
                headers['Access-Control-Allow-Origin'],
                allowed ? origin : undefined,
                `${method} ${origin}`
            );
            if (allowed) assert.equal(headers.Vary, 'Origin');
        }
    }
} finally {
    if (previous.origins === undefined) delete process.env.PUBLIC_APP_ORIGINS;
    else process.env.PUBLIC_APP_ORIGINS = previous.origins;
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
}
