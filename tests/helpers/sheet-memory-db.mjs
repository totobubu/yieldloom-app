// Synthetic, transactional Firestore test double. Never connects to Firebase.
export function memoryDb(initial = []) {
    const store = new Map(initial.map(([p, v]) => [p, structuredClone(v)]));
    const reads = [],
        writes = [];
    let failCommit = false;
    const snapshot = (path) => ({
        id: path.split('/').at(-1),
        ref: ref(path),
        exists: store.has(path),
        data: () => structuredClone(store.get(path)),
    });
    const field = (d, key) =>
        typeof key === 'string' ? d.data()?.[key] : d.id;
    function collection(
        path,
        filters = [],
        orders = [],
        after = null,
        count = Infinity
    ) {
        return {
            path,
            doc: (id) => ref(`${path}/${id}`),
            where: (key, op, value) =>
                collection(
                    path,
                    [...filters, [key, op, value]],
                    orders,
                    after,
                    count
                ),
            orderBy: (key, direction = 'asc') =>
                collection(
                    path,
                    filters,
                    [...orders, [key, direction]],
                    after,
                    count
                ),
            startAfter: (...values) =>
                collection(path, filters, orders, values, count),
            limit: (size) => collection(path, filters, orders, after, size),
            async get() {
                reads.push(`${path}:query`);
                let docs = [...store.keys()]
                    .filter(
                        (p) =>
                            p.startsWith(path + '/') &&
                            p.split('/').length === path.split('/').length + 1
                    )
                    .map(snapshot);
                docs = docs.filter((d) =>
                    filters.every(([k, op, v]) =>
                        op === '>'
                            ? field(d, k) > v
                            : op === '<='
                              ? field(d, k) <= v
                              : op === '=='
                                ? field(d, k) === v
                                : false
                    )
                );
                const compare = (left, right) => {
                    for (const [i, [k, dir]] of orders.entries()) {
                        const a = field(left, k),
                            b = right[i];
                        if (a !== b)
                            return (a > b ? 1 : -1) * (dir === 'desc' ? -1 : 1);
                    }
                    return 0;
                };
                docs.sort((a, b) =>
                    compare(
                        a,
                        orders.map(([k]) => field(b, k))
                    )
                );
                if (after) docs = docs.filter((d) => compare(d, after) > 0);
                docs = docs.slice(0, count);
                return { docs, size: docs.length, empty: !docs.length };
            },
        };
    }
    function ref(path) {
        return {
            path,
            id: path.split('/').at(-1),
            collection: (name) => collection(`${path}/${name}`),
            async get() {
                reads.push(path);
                return snapshot(path);
            },
        };
    }
    return {
        store,
        reads,
        writes,
        collection,
        doc: ref,
        failNextCommit() {
            failCommit = true;
        },
        async runTransaction(fn, options) {
            const pending = [];
            const result = await fn({
                get: (r) => {
                    if (pending.length) throw Error('read after write');
                    return r.get();
                },
                set: (r, v) => pending.push([r.path, structuredClone(v)]),
            });
            if (options?.readOnly && pending.length)
                throw Error('read-only writes');
            if (failCommit && pending.length) {
                failCommit = false;
                throw Error('synthetic interrupted commit');
            }
            for (const [p, v] of pending) {
                store.set(p, v);
                writes.push(p);
            }
            return result;
        },
    };
}
