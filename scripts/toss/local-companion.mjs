#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
    createLocalVault,
    createLocalCredentials,
} from '../../lib/toss-local-vault.js';
import {
    createLocalCompanion,
    createCompanionCloud,
} from '../../lib/toss-local-companion.js';
import { ConnectionError } from '../../lib/account-toss-connection.js';
const here = dirname(fileURLToPath(import.meta.url));
const origins = new Set([
    'https://yieldloom-app.vercel.app',
    'https://totobubu.github.io',
]);

export function createCompanionHttp(companion, { port = 43129 } = {}) {
    return createServer(async (req, res) => {
        const localOrigin = `http://127.0.0.1:${port}`,
            origin = req.headers.origin;
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
        );
        const send = (status, body) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body));
        };
        try {
            if (
                req.headers.host !== `127.0.0.1:${port}` ||
                req.socket.remoteAddress !== '127.0.0.1'
            )
                throw new ConnectionError('LOCAL_ORIGIN_REJECTED', 403);
            const path = new URL(req.url, localOrigin).pathname;
            const local =
                origin === localOrigin ||
                (!origin && req.headers['sec-fetch-site'] === 'same-origin');
            const allowed = origin && origins.has(origin);
            if (allowed) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
                res.setHeader(
                    'Access-Control-Allow-Headers',
                    'content-type, x-yieldloom-pairing'
                );
                res.setHeader('Access-Control-Allow-Private-Network', 'true');
            }
            if (req.method === 'OPTIONS')
                return allowed
                    ? send(204, {})
                    : send(403, { error: 'LOCAL_ORIGIN_REJECTED' });
            if (
                req.method === 'GET' &&
                ['/', '/register', '/app.js', '/app.css'].includes(path)
            ) {
                if (origin && !local && !allowed)
                    throw new ConnectionError('LOCAL_ORIGIN_REJECTED', 403);
                const filename = {
                    '/': 'index.html',
                    '/register': 'index.html',
                    '/app.js': 'app.js',
                    '/app.css': 'app.css',
                }[path];
                res.setHeader(
                    'Content-Type',
                    path === '/app.js'
                        ? 'text/javascript'
                        : path === '/app.css'
                          ? 'text/css'
                          : 'text/html; charset=utf-8'
                );
                return res.end(
                    await readFile(resolve(here, 'local-ui', filename))
                );
            }
            if (req.method === 'GET' && path === '/session') {
                if (!local)
                    throw new ConnectionError('LOCAL_ORIGIN_REJECTED', 403);
                return send(200, { pairing: companion.pairing });
            }
            if (
                req.method !== 'POST' ||
                (!local && !allowed) ||
                !companion.paired(req.headers['x-yieldloom-pairing'])
            )
                throw new ConnectionError('LOCAL_PAIRING_REQUIRED', 403);
            if (
                ['/unlock', '/lock', '/enroll', '/flow-info'].includes(path) &&
                !local
            )
                throw new ConnectionError('LOCAL_ORIGIN_REJECTED', 403);
            let size = 0;
            const chunks = [];
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 16000)
                    throw new ConnectionError('INVALID_REQUEST', 413);
                chunks.push(chunk);
            }
            if (
                !String(req.headers['content-type']).startsWith(
                    'application/json'
                )
            )
                throw new ConnectionError('INVALID_REQUEST', 400);
            let input;
            try {
                input = JSON.parse(Buffer.concat(chunks).toString());
            } catch {
                throw new ConnectionError('INVALID_REQUEST', 400);
            }
            if (!input || typeof input !== 'object' || Array.isArray(input))
                throw new ConnectionError('INVALID_REQUEST', 400);
            return send(200, await companion.act(path, input));
        } catch (error) {
            // Never log bodies, exception text, credential values or pairing codes.
            return send(error instanceof ConnectionError ? error.status : 503, {
                error:
                    error instanceof ConnectionError
                        ? error.code
                        : 'LOCAL_REQUEST_FAILED',
            });
        }
    });
}
export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            help: { type: 'boolean' },
            serve: { type: 'boolean' },
            directory: { type: 'string' },
        },
    });
    if (values.help || !values.serve) {
        console.log(
            'Local companion: node scripts/toss/local-companion.mjs --serve [--directory PRIVATE_DIRECTORY]\nRequires separately approved local credential enrollment, provider IP registration and cloud activation. No credentials are read or created by --help.\nOpen http://127.0.0.1:43129 on this PC. Secrets are entered only in that local page; never paste them into the hosted app.'
        );
        return;
    }
    const directory = values.directory
        ? resolve(values.directory)
        : resolve(homedir(), '.yieldloom-toss');
    const within = relative(resolve(here, '../..'), directory);
    if (
        !within ||
        (!isAbsolute(within) &&
            within !== '..' &&
            !within.startsWith('..' + sep))
    )
        throw new Error(
            'Local credential storage must be outside the source checkout.'
        );
    const vault = createLocalVault(directory);
    const companion = createLocalCompanion({
        vault,
        credentials: createLocalCredentials({ vault }),
        cloud: createCompanionCloud(),
    });
    const server = createCompanionHttp(companion);
    server.listen(43129, '127.0.0.1', () =>
        console.log(
            'Local companion ready: http://127.0.0.1:43129 (credentials remain locked)'
        )
    );
    const close = () => {
        companion.close();
        server.close();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    server.on('error', () => {
        companion.close();
        console.error(
            'Local companion could not start; no credential values were emitted.'
        );
        process.exitCode = 1;
    });
}
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    main().catch(() => {
        console.error('Invalid local companion request. Use --help.');
        process.exitCode = 1;
    });
