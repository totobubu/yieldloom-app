import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';

// Two bounded, server-only derived models per account. No TTL: freshness is
// established by the account revision, never elapsed time or process lifetime.
const digest = (value) => createHash('sha256').update(value).digest('hex');
const unavailable = (message, code = 'CAPITAL_READ_MODEL_BUSY') =>
    Object.assign(new Error(message), { status: 503, code });

export async function capitalReadModel({
    db,
    root,
    name,
    version,
    load,
    validate,
    read,
    now = Date.now,
    leaseMs = 120000,
}) {
    const ref = db.doc(`${root}/capitalReadModels/${name}`);
    const partRef = (index) =>
        db.doc(`${root}/capitalReadModels/${name}-part-${index}`);
    const decode = async (data, tx) => {
        if (data?.version !== version || data.state !== 'ready') return null;
        if (
            !Number.isInteger(data.partCount) ||
            data.partCount < 0 ||
            data.partCount > 10
        )
            throw unavailable(
                '조회 자료를 확인하지 못했습니다.',
                'CAPITAL_READ_MODEL_CORRUPT'
            );
        const parts = data.partCount
            ? await Promise.all(
                  Array.from({ length: data.partCount }, (_, i) =>
                      read(partRef(i), tx)
                  )
              )
            : [];
        if (parts.some((part) => part.data()?.generation !== data.generation))
            throw unavailable('조회 자료가 갱신 중입니다. 다시 조회해 주세요.');
        try {
            const bytes = parts.length
                ? Buffer.concat(
                      parts.map((part) =>
                          Buffer.from(part.data().payload, 'base64')
                      )
                  )
                : Buffer.from(data.payload, 'base64');
            if (digest(bytes) !== data.sha256) throw new Error('digest');
            return JSON.parse(gunzipSync(bytes, { maxOutputLength: 64000000 }));
        } catch {
            throw unavailable(
                '조회 자료를 확인하지 못했습니다. 관리자에게 문의해 주세요.',
                'CAPITAL_READ_MODEL_CORRUPT'
            );
        }
    };
    const saved = await decode((await read(ref)).data());
    if (saved) return { value: saved, cache: 'durable-hit' };
    const owner = randomUUID();
    const acquired = await db.runTransaction(async (tx) => {
        const snapshot = await read(ref, tx),
            data = snapshot.data();
        const current = await decode(data, tx);
        if (current) return current;
        // One builder across all revisions and instances. A crashed builder can
        // be replaced after its lease; its later publication is fenced out.
        if (
            (data?.version === version && data?.blocked) ||
            data?.retryAfter > now() ||
            data?.leaseUntil > now()
        )
            throw unavailable(
                '조회 자료를 준비 중입니다. 잠시 후 다시 조회해 주세요.'
            );
        await validate(tx);
        tx.set(ref, {
            state: 'building',
            version,
            owner,
            leaseUntil: now() + leaseMs,
            partCount: data?.partCount || 0,
        });
        return null;
    });
    if (acquired) return { value: acquired, cache: 'durable-hit' };
    try {
        const value = await load();
        const json = Buffer.from(JSON.stringify(value));
        const payload = gzipSync(json);
        // Each base64 part is <=600k, the entire publish transaction <10 MiB.
        // Oversized models fail closed, never truncate or repeatedly fall back to scans.
        if (json.length > 64000000 || payload.length > 4500000)
            throw unavailable(
                '조회 자료가 커 별도 처리가 필요합니다.',
                'CAPITAL_READ_MODEL_TOO_LARGE'
            );
        await db.runTransaction(async (tx) => {
            const data = (await read(ref, tx)).data();
            await validate(tx);
            if (data?.owner !== owner || data.version !== version)
                throw unavailable(
                    '조회 자료가 갱신 중입니다. 다시 조회해 주세요.'
                );
            const partCount =
                payload.length > 450000
                    ? Math.ceil(payload.length / 450000)
                    : 0;
            for (let i = 0; i < partCount; i++)
                tx.set(partRef(i), {
                    generation: owner,
                    payload: payload
                        .subarray(i * 450000, (i + 1) * 450000)
                        .toString('base64'),
                });
            for (let i = partCount; i < (data.partCount || 0); i++)
                tx.delete(partRef(i));
            tx.set(ref, {
                state: 'ready',
                version,
                generation: owner,
                partCount,
                ...(partCount ? {} : { payload: payload.toString('base64') }),
                sha256: digest(payload),
            });
        });
        return { value, cache: 'durable-build' };
    } catch (error) {
        // Failed/partial results never become successful cache entries. Backoff
        // also prevents every new instance from repeating a failed full scan.
        await db
            .runTransaction(async (tx) => {
                const data = (await read(ref, tx)).data();
                if (data?.owner === owner)
                    tx.set(ref, {
                        state: 'failed',
                        version,
                        retryAfter: now() + 60000,
                        partCount: data.partCount || 0,
                        blocked: error.code === 'CAPITAL_READ_MODEL_TOO_LARGE',
                    });
            })
            .catch(() => {}); // If quota also prevents this, the lease still fences retries.
        throw error;
    }
}
