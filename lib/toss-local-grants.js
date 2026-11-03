import { createPublicKey, sign, verify } from 'node:crypto';
import { ConnectionError, accountDigest } from './account-toss-connection.js';

export const stableJson = (v) =>
    JSON.stringify(v, (_, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(
                  Object.keys(value)
                      .sort()
                      .map((key) => [key, value[key]])
              )
            : value
    );
export const localHash = (v) => accountDigest(stableJson(v));
export function createLocalGrantSigner(privateKey) {
    const publicKey = createPublicKey(privateKey)
        .export({ type: 'spki', format: 'pem' })
        .toString();
    const kid = accountDigest(publicKey);
    return {
        publicKey: { kid, publicKey },
        sign(claims) {
            const body = Buffer.from(stableJson({ ...claims, kid })).toString(
                'base64url'
            );
            return `${body}.${sign('sha256', Buffer.from(body), privateKey).toString('base64url')}`;
        },
    };
}
export function verifyLocalGrant(
    envelope,
    key,
    { nonce, operation, now = Date.now() }
) {
    try {
        if (typeof envelope !== 'string' || envelope.length > 8192)
            throw Error();
        const [body, signature, extra] = envelope.split('.');
        if (
            extra ||
            !body ||
            !signature ||
            !verify(
                'sha256',
                Buffer.from(body),
                key.publicKey,
                Buffer.from(signature, 'base64url')
            )
        )
            throw Error();
        const claims = JSON.parse(Buffer.from(body, 'base64url'));
        if (
            claims.kid !== key.kid ||
            key.kid !== accountDigest(key.publicKey) ||
            claims.aud !== 'yieldloom-local-toss/v1' ||
            claims.nonce !== nonce ||
            claims.operation !== operation ||
            !Number.isSafeInteger(claims.exp) ||
            !Number.isSafeInteger(claims.iat) ||
            claims.iat > now + 5000 ||
            claims.exp <= now ||
            claims.exp - claims.iat >
                (operation === 'configure' ? 600000 : 60000) ||
            claims.actorUid !== claims.subjectUid ||
            !claims.actorUid ||
            !/^[\w-]{1,100}$/.test(claims.accountId || '') ||
            !/^\d{4}$/.test(claims.suffix || '')
        )
            throw Error();
        return claims;
    } catch {
        throw new ConnectionError('LOCAL_GRANT_REJECTED', 403);
    }
}
