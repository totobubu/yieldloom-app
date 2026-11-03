import { createAccountTossHandler } from '../../lib/account-toss-handler.js';
import { accountTossFixture } from '../../tests/support/account-toss-fixture.mjs';

// Explicit opt-in, loopback-only development API. No real credentials or network.
export function tossConnectionMockPlugin(enabled) {
    return {
        name: 'toss-connection-local-fixture',
        apply: 'serve',
        configureServer(server) {
            if (!enabled) return;
            const fixture = accountTossFixture();
            const handler = createAccountTossHandler({
                authenticate: async (req) => {
                    const token = req.headers.authorization;
                    return ['demo-wife', 'demo-husband', 'demo-viewer']
                        .map((uid) => ({ uid }))
                        .find(({ uid }) => token === `Bearer ${uid}`);
                },
                service: fixture.service,
            });
            server.middlewares.use(
                '/__dev/toss-connection',
                async (req, res) => {
                    res.setHeader('Cache-Control', 'private, no-store');
                    const host = req.headers.host;
                    const loopback =
                        /^(127\.0\.0\.1|localhost):\d+$/.test(host ?? '') &&
                        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
                            req.socket.remoteAddress
                        );
                    if (
                        !loopback ||
                        (req.headers.origin &&
                            req.headers.origin !== `http://${host}`)
                    ) {
                        res.statusCode = 403;
                        res.end();
                        return;
                    }
                    res.status = (status) => {
                        res.statusCode = status;
                        return res;
                    };
                    res.json = (body) => {
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify(body));
                    };
                    try {
                        const chunks = [];
                        let size = 0;
                        for await (const chunk of req) {
                            size += chunk.length;
                            if (size > 4096) throw Error();
                            chunks.push(chunk);
                        }
                        req.query = Object.fromEntries(
                            new URL(req.url, 'http://localhost').searchParams
                        );
                        req.body = chunks.length
                            ? JSON.parse(Buffer.concat(chunks).toString())
                            : {};
                        await handler(req, res);
                    } catch {
                        res.status(400).json({ error: 'INVALID_REQUEST' });
                    }
                }
            );
        },
    };
}
