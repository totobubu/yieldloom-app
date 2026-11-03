// Synthetic in-memory serializable transactions; never connects to a database.
import { capitalHandler } from '../../lib/portfolio-capital-handler.js';
export function createCapitalFixture(uid = 'owner', initialRecords = []) {
    const records = new Map(initialRecords);
    let transactionQueue = Promise.resolve();
    const reads = [],
        usage = [];
    const ref = (path) => ({
        path,
        get: async () => {
            reads.push(path);
            return snapshot(path);
        },
    });
    const snapshot = (path) => ({
        id: path.split('/').at(-1),
        exists: records.has(path),
        data: () => records.get(path),
    });
    const db = {
        doc: ref,
        collection: (path) => {
            const get = async (field, value) => {
                reads.push(path);
                return {
                    docs: [...records.keys()]
                        .filter(
                            (k) =>
                                k.startsWith(path + '/') &&
                                !k.slice(path.length + 1).includes('/') &&
                                (!field ||
                                    field
                                        .split('.')
                                        .reduce(
                                            (v, key) => v?.[key],
                                            records.get(k)
                                        ) === value)
                        )
                        .map(snapshot),
                };
            };
            return {
                get: () => get(),
                where: (field, op, value) => ({ get: () => get(field, value) }),
            };
        },
        runTransaction: (fn) => {
            const operation = async () => {
                const writes = [];
                const result = await fn({
                    get: async (r) => snapshot(r.path),
                    set: (r, d) => writes.push([r.path, d]),
                });
                for (const [p, d] of writes) records.set(p, d);
                return result;
            };
            const result = transactionQueue.then(operation);
            transactionQueue = result.catch(() => {});
            return result;
        },
    };
    const handler = capitalHandler({
        verify: async () => {
            if (!uid) throw Object.assign(new Error('login'), { status: 401 });
            return { uid };
        },
        database: () => db,
        timestamp: () => 'now',
        onReadUsage: (row) => usage.push(row),
    });
    const call = async (body, method = 'POST', query = {}) => {
        let status, data;
        await handler(
            { method, body, query },
            {
                setHeader() {},
                status(s) {
                    status = s;
                    return this;
                },
                json(d) {
                    data = d;
                    return this;
                },
            }
        );
        return { status, data };
    };
    return { call, records, reads, usage };
}
