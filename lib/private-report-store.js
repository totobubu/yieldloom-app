import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

// Never use the public bucket or a public URL for private financial reports.
const BUCKET = 'yieldloom-data-private';
export const reportIndexKey = 'reconciliation/dashboard/v1/current.json';
export const sourceTimesIndexKey =
    'reconciliation/dashboard/v1/source-times/current.json';
let storage;
function configuredStorage() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } =
        process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)
        throw Object.assign(
            new Error('비공개 보고서 읽기 설정이 필요합니다.'),
            { status: 503 }
        );
    return (storage ||= new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
    }));
}
export const reportDigest = (bytes) =>
    createHash('sha256').update(bytes).digest('hex');
export function createPrivateReportStore({
    getStorage = configuredStorage,
} = {}) {
    return {
        async read(key, { maxBytes = 512_000, sha256 } = {}) {
            if (
                !/^reconciliation\/dashboard\/v1\/[A-Za-z0-9/_.-]+\.json$/.test(
                    key
                ) ||
                key.includes('..')
            )
                throw Object.assign(
                    new Error('보고서 경로가 올바르지 않습니다.'),
                    { status: 400 }
                );
            const result = await getStorage().send(
                new GetObjectCommand({ Bucket: BUCKET, Key: key })
            );
            if (result.ContentLength > maxBytes)
                throw new Error('Report size limit');
            const chunks = [];
            let bytes = 0;
            for await (const chunk of result.Body) {
                const b = Buffer.from(chunk);
                bytes += b.length;
                if (bytes > maxBytes) {
                    result.Body.destroy?.();
                    throw new Error('Report size limit');
                }
                chunks.push(b);
            }
            const body = Buffer.concat(chunks);
            if (sha256 && reportDigest(body) !== sha256)
                throw new Error('Report digest mismatch');
            return JSON.parse(body.toString('utf8'));
        },
    };
}
