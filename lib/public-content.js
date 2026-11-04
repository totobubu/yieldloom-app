// Shared by browser and server. Only an explicitly configured channel is read.
export function publicContentRoot(base, channel) {
    if (!base) return '';
    if (!/^production$|^preview-[a-f0-9]{16}$/.test(channel || ''))
        throw Error('Explicit public content channel required');
    return `${base.replace(/\/+$/, '')}/public-content/${channel}`;
}

export function createPublicContentReader({ root, read, sha256 }) {
    const validHash = (value) => /^[a-f0-9]{64}$/.test(value || '');
    return async (name, options = {}) => {
        if (
            !/^(?:distribution-index|distribution-ticker-[a-z0-9.-]+|stock-evidence-index|stock-evidence-[a-z0-9.-]+|price-index|price-quality)\.json$/i.test(
                name
            )
        )
            throw Error('Invalid public projection');
        let releaseId = options.releaseId;
        if (!releaseId) {
            const pointer = await read(`${root}/current.json`, {
                ...options,
                immutable: false,
            });
            if (pointer.schemaVersion !== 1 || !validHash(pointer.releaseId))
                throw Error('Invalid public content pointer');
            releaseId = pointer.releaseId;
        }
        if (!validHash(releaseId)) throw Error('Invalid public release ID');
        const manifest = await read(
            `${root}/releases/${releaseId}/manifest.json`,
            { ...options, immutable: true }
        );
        if (manifest.schemaVersion !== 1 || manifest.releaseId !== releaseId)
            throw Error('Invalid public content manifest');
        const entry = manifest.files?.[name];
        if (!validHash(entry?.sha256)) throw Error('Missing public projection');
        const text = await read(`${root}/objects/${entry.sha256}.json`, {
            ...options,
            immutable: true,
            text: true,
        });
        if ((await sha256(text)) !== entry.sha256)
            throw Error('Public projection hash mismatch');
        const value = JSON.parse(text);
        return { value, releaseId };
    };
}
