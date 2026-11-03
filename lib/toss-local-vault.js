// Same-computer companion only. Secrets are encrypted on disk and never returned
// from the bridge. The passphrase/key lives only until lock/process exit.
import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scryptSync,
} from 'node:crypto';
import { mkdir, open, readFile, rename, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConnectionError, accountDigest } from './account-toss-connection.js';
const stop = (code) => {
    throw new ConnectionError(code, 409);
};
export function createLocalVault(directory) {
    const root = resolve(directory),
        path = join(root, 'vault.json'),
        lockPath = join(root, 'writer.lock');
    let key, salt;
    async function safeRoot() {
        await mkdir(root, { recursive: true, mode: 0o700 });
        const stat = await lstat(root);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (process.platform !== 'win32' && stat.mode & 0o077)
        )
            stop('LOCAL_STORAGE_PERMISSIONS');
    }
    const decode = (record) => {
        if (!key || record.version !== 1 || record.salt !== salt)
            stop('LOCAL_VAULT_LOCKED');
        const decipher = createDecipheriv(
            'aes-256-gcm',
            key,
            Buffer.from(record.iv, 'base64')
        );
        decipher.setAAD(Buffer.from(`yieldloom-local-vault/v1:${salt}`));
        decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
        return JSON.parse(
            Buffer.concat([
                decipher.update(Buffer.from(record.ciphertext, 'base64')),
                decipher.final(),
            ]).toString()
        );
    };
    async function load() {
        if (!key) stop('LOCAL_VAULT_LOCKED');
        const stat = await lstat(path);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size > 16000000 ||
            (process.platform !== 'win32' && stat.mode & 0o077)
        )
            stop('LOCAL_STORAGE_PERMISSIONS');
        try {
            return decode(JSON.parse(await readFile(path, 'utf8')));
        } catch (e) {
            if (e instanceof ConnectionError) throw e;
            stop('LOCAL_VAULT_INVALID');
        }
    }
    async function save(state) {
        const iv = randomBytes(12),
            cipher = createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(`yieldloom-local-vault/v1:${salt}`));
        const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(state)),
            cipher.final(),
        ]);
        const record = {
            version: 1,
            salt,
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64'),
        };
        const temp = join(
            root,
            `.vault-${randomBytes(16).toString('hex')}.tmp`
        );
        const file = await open(temp, 'wx', 0o600);
        try {
            await file.writeFile(JSON.stringify(record));
            await file.sync();
        } finally {
            await file.close();
        }
        try {
            await rename(temp, path);
            if (process.platform !== 'win32') {
                const directory = await open(root, 'r');
                try {
                    await directory.sync();
                } finally {
                    await directory.close();
                }
            }
        } finally {
            await rm(temp, { force: true });
        }
    }
    async function exclusive(work) {
        await safeRoot();
        try {
            await mkdir(lockPath, { mode: 0o700 });
        } catch (error) {
            if (error.code === 'EEXIST') stop('LOCAL_SYNC_BUSY');
            throw error;
        }
        try {
            return await work();
        } finally {
            await rm(lockPath, { recursive: true });
        }
    }
    return {
        root,
        lock() {
            key?.fill(0);
            key = undefined;
            salt = undefined;
        },
        async unlock(passphrase) {
            if (
                typeof passphrase !== 'string' ||
                passphrase.length < 12 ||
                passphrase.length > 256
            )
                stop('LOCAL_PASSPHRASE_REQUIRED');
            return exclusive(async () => {
                let record;
                try {
                    record = JSON.parse(await readFile(path, 'utf8'));
                } catch (e) {
                    if (e.code !== 'ENOENT') stop('LOCAL_VAULT_INVALID');
                }
                const nextSalt =
                    record?.salt ?? randomBytes(32).toString('base64');
                if (
                    typeof nextSalt !== 'string' ||
                    Buffer.from(nextSalt, 'base64').length !== 32
                )
                    stop('LOCAL_VAULT_INVALID');
                const nextKey = scryptSync(
                    passphrase,
                    Buffer.from(nextSalt, 'base64'),
                    32
                );
                key?.fill(0);
                key = nextKey;
                salt = nextSalt;
                try {
                    if (record) await load();
                    else
                        await save({
                            version: 1,
                            bindings: {},
                            clients: {},
                            queue: [],
                        });
                } catch {
                    key.fill(0);
                    key = undefined;
                    salt = undefined;
                    stop('LOCAL_VAULT_INVALID');
                }
                return { unlocked: true };
            });
        },
        read: load,
        async transaction(work) {
            return exclusive(async () => {
                const state = await load();
                const result = await work(state, () => save(state));
                await save(state);
                return result;
            });
        },
    };
}

export function createLocalCredentials({
    vault,
    fetchImpl = fetch,
    now = Date.now,
}) {
    return {
        async enroll(grant, form) {
            if (
                !form ||
                Object.keys(form).some(
                    (k) =>
                        ![
                            'clientId',
                            'clientSecret',
                            'accountNo',
                            'confirmed',
                            'replaceExisting',
                        ].includes(k)
                ) ||
                form.confirmed !== true ||
                typeof form.clientId !== 'string' ||
                !/^[\w-]{8,200}$/.test(form.clientId) ||
                typeof form.clientSecret !== 'string' ||
                form.clientSecret.length < 8 ||
                form.clientSecret.length > 500 ||
                typeof form.accountNo !== 'string' ||
                !/^\d{8,30}$/.test(form.accountNo) ||
                !form.accountNo.endsWith(grant.suffix)
            )
                stop('INVALID_REQUEST');
            const digest = accountDigest(form.accountNo),
                clientIdentity = accountDigest(form.clientId);
            if (grant.accountNoSha256 && grant.accountNoSha256 !== digest)
                stop('STALE_BINDING');
            return vault.transaction(async (state) => {
                if (
                    Object.values(state.bindings).some(
                        (b) =>
                            b.accountId !== grant.accountId &&
                            b.accountNoSha256 === digest
                    )
                )
                    stop('DUPLICATE_ACCOUNT_BINDING');
                const existing = state.clients[clientIdentity];
                if (existing && existing.subjectUid !== grant.subjectUid)
                    stop('CLIENT_ALREADY_REGISTERED');
                if (existing && existing.clientSecret !== form.clientSecret) {
                    if (form.replaceExisting !== true)
                        stop('CLIENT_ALREADY_REGISTERED');
                    existing.clientSecret = form.clientSecret;
                    existing.generation = (existing.generation || 1) + 1;
                    existing.tokenStatus = 'missing';
                    delete existing.token;
                    delete existing.expiresAt;
                }
                state.clients[clientIdentity] ??= {
                    clientId: form.clientId,
                    clientSecret: form.clientSecret,
                    subjectUid: grant.subjectUid,
                    tokenStatus: 'missing',
                    generation: 1,
                };
                state.bindings[grant.accountId] = {
                    accountId: grant.accountId,
                    subjectUid: grant.subjectUid,
                    credentialRef: clientIdentity,
                    accountNoSha256: digest,
                    suffix: grant.suffix,
                    revision: grant.bindingRevision,
                    enabled: true,
                };
                return { registered: true };
            });
        },
        async issue(ref, confirmed) {
            if (confirmed !== true) stop('TOKEN_CONFIRMATION_REQUIRED');
            return vault.transaction(async (state, persist) => {
                const client = state.clients[ref];
                if (!client) stop('LOCAL_PROFILE_REQUIRED');
                if (client.tokenStatus === 'issuing')
                    stop('TOKEN_ISSUANCE_UNCERTAIN');
                client.tokenStatus = 'issuing';
                delete client.token;
                delete client.expiresAt;
                // Durable intent before external issuance; uncertain outcomes never
                // cause a second token request after a crash/network failure.
                await persist();
                try {
                    const response = await fetchImpl(
                        'https://openapi.tossinvest.com/oauth2/token',
                        {
                            method: 'POST',
                            redirect: 'error',
                            signal: AbortSignal.timeout(30000),
                            headers: {
                                'Content-Type':
                                    'application/x-www-form-urlencoded',
                            },
                            body: new URLSearchParams({
                                grant_type: 'client_credentials',
                                client_id: client.clientId,
                                client_secret: client.clientSecret,
                            }).toString(),
                        }
                    );
                    if (!response.ok) {
                        await response.body?.cancel();
                        stop('AUTHORIZATION_REQUIRED');
                    }
                    const result = await response.json();
                    if (
                        typeof result.access_token !== 'string' ||
                        !result.access_token ||
                        !Number.isFinite(result.expires_in) ||
                        result.expires_in <= 30
                    )
                        stop('AUTHORIZATION_REQUIRED');
                    client.token = result.access_token;
                    client.expiresAt = now() + result.expires_in * 1000;
                    client.tokenStatus = 'active';
                    return { issued: true };
                } catch {
                    stop('TOKEN_ISSUANCE_UNCERTAIN');
                }
            });
        },
        withExistingToken: (ref, work) =>
            vault.transaction(async (state) => {
                const client = state.clients[ref];
                if (
                    !client ||
                    client.tokenStatus !== 'active' ||
                    client.expiresAt <= now() + 30000
                )
                    stop('AUTHORIZATION_REQUIRED');
                return work(client.token);
            }),
    };
}
