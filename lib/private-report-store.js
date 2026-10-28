import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import {
    followupCheckpoint,
    verifiedFollowup,
} from './toss-followup-report.js';
import {
    readFinalLedger,
    finalLedgerCheckpoint,
} from './final-ledger-snapshot.js';

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
    checkpoint = followupCheckpoint,
    finalCheckpoint = finalLedgerCheckpoint,
} = {}) {
    const finalCache = new Map();
    async function readBytes(key, maxBytes) {
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
        return Buffer.concat(chunks);
    }
    return {
        async readFinalSnapshot(owner) {
            const cached = finalCache.get(owner);
            if (cached && cached.expires > Date.now()) return cached.task;
            // Only compact projections are retained; authorization is rechecked before every access.
            const task = readFinalLedger(readBytes, finalCheckpoint).catch(
                (error) => {
                    if (finalCache.get(owner)?.task === task)
                        finalCache.delete(owner);
                    if (
                        error.$metadata?.httpStatusCode === 403 ||
                        error.name === 'AccessDenied'
                    )
                        throw Object.assign(
                            new Error('최종 데이터 읽기 권한을 확인해 주세요.'),
                            { status: 503, code: 'REPORT_STORAGE_DENIED' }
                        );
                    throw error;
                }
            );
            if (finalCache.size >= 2)
                finalCache.delete(finalCache.keys().next().value);
            finalCache.set(owner, { task, expires: Date.now() + 300_000 });
            return task;
        },
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
            const body = await readBytes(key, maxBytes);
            if (sha256 && reportDigest(body) !== sha256)
                throw new Error('Report digest mismatch');
            return JSON.parse(body.toString('utf8'));
        },
        // No caller-supplied object path. Constructor injection is for isolated fixtures only.
        async readFollowup() {
            try {
                const zip = await readBytes(checkpoint.key, 128_000);
                const evidence = await readBytes(
                    checkpoint.evidenceKey,
                    128_000
                );
                return verifiedFollowup(zip, evidence, checkpoint);
            } catch (error) {
                if (
                    ['NoSuchKey', 'NotFound'].includes(error.name) ||
                    error.$metadata?.httpStatusCode === 404
                )
                    throw Object.assign(
                        new Error(
                            '보존된 후속 보고서 또는 원문 증거가 없습니다.'
                        ),
                        { status: 404, code: 'REPORT_NOT_FOUND' }
                    );
                if (
                    ['AccessDenied', 'Forbidden'].includes(error.name) ||
                    error.$metadata?.httpStatusCode === 403
                )
                    throw Object.assign(
                        new Error(
                            '기존 비공개 저장소 읽기 권한을 확인해 주세요.'
                        ),
                        { status: 503, code: 'REPORT_STORAGE_DENIED' }
                    );
                throw error;
            }
        },
    };
}
