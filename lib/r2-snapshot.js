import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const configured = () => Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
let client;

function r2() {
    if (!configured()) return null;
    if (!client) client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    });
    return client;
}

const keyFor = (symbol) => `yieldloom/thumbnail-snapshots/v1/${String(symbol).toUpperCase()}.json`;
const bodyText = async (body) => typeof body?.transformToString === 'function' ? body.transformToString() : Buffer.concat(await body.transformToByteArray()).toString('utf8');

export async function readTickerSnapshot(symbol) {
    const storage = r2();
    if (!storage) return null;
    try {
        const result = await storage.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: keyFor(symbol) }));
        return JSON.parse(await bodyText(result.Body));
    } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') return null;
        throw error;
    }
}

export async function writeTickerSnapshot(symbol, value) {
    const storage = r2();
    if (!storage) return false;
    const payload = JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), value });
    await storage.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: keyFor(symbol),
        Body: payload,
        ContentType: 'application/json',
        CacheControl: 'no-store',
    }));
    return true;
}
