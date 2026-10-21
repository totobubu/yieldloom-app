import { createHash } from 'node:crypto';
import { isPortfolioAdmin } from './portfolio-admin.js';

export const feedbackCategories = [
    'data_error',
    'information_request',
    'question',
    'other',
];
export const feedbackStatuses = ['new', 'in_review', 'resolved', 'spam'];

const symbolPattern = /^[A-Z][A-Z0-9.-]{0,11}$/;
const requestPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const text = (value) => String(value ?? '').trim();

export function validateFeedback(body) {
    const symbol = text(body.symbol).toUpperCase();
    const category = text(body.category);
    const message = text(body.message);
    const requestId = text(body.requestId);
    const pageUrl = text(body.pageUrl);
    if (text(body.website)) fail('요청을 처리할 수 없습니다.');
    if (!symbolPattern.test(symbol)) fail('종목 코드를 확인해 주세요.');
    if (!feedbackCategories.includes(category))
        fail('의견 유형을 확인해 주세요.');
    if (message.length < 10 || message.length > 1000)
        fail('내용을 10~1,000자로 입력해 주세요.');
    if (!requestPattern.test(requestId)) fail('요청 식별자를 확인해 주세요.');
    let normalizedPageUrl = '';
    try {
        const parsed = new URL(pageUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        normalizedPageUrl = `${parsed.origin}/stock/${encodeURIComponent(symbol)}`;
    } catch {
        fail('종목 상세 주소를 확인해 주세요.');
    }
    return { symbol, category, message, requestId, pageUrl: normalizedPageUrl };
}

const clientAddress = (req) =>
    text(req.headers?.['x-forwarded-for']).split(',')[0].trim() ||
    text(req.socket?.remoteAddress) ||
    'unknown';

function requireAllowedOrigin(req) {
    const origin = text(req.headers?.origin).replace(/\/+$/, '');
    if (!origin && !process.env.VERCEL) return;
    const requestHost = text(
        req.headers?.['x-forwarded-host'] || req.headers?.host
    ).toLowerCase();
    try {
        if (origin && new URL(origin).host.toLowerCase() === requestHost)
            return;
    } catch {
        fail('허용되지 않은 요청 출처입니다.', 403);
    }
    const allowed = new Set([
        'http://localhost:5173',
        'http://localhost:3000',
        'https://totobubu.github.io',
        ...text(process.env.PUBLIC_APP_ORIGINS)
            .split(',')
            .map((value) => value.trim().replace(/\/+$/, ''))
            .filter(Boolean),
        ...(process.env.VERCEL_URL
            ? [`https://${String(process.env.VERCEL_URL).replace(/\/+$/, '')}`]
            : []),
    ]);
    if (!allowed.has(origin)) fail('허용되지 않은 요청 출처입니다.', 403);
}

export function stockFeedbackHandler({
    verify,
    database,
    now = () => new Date(),
    salt = () => process.env.FEEDBACK_IP_SALT,
}) {
    return async (req, res) => {
        try {
            res.setHeader('Cache-Control', 'private, no-store');
            const db = database();
            if (req.method === 'POST') {
                requireAllowedOrigin(req);
                const secret = text(salt());
                if (!secret) fail('의견함 설정을 확인하지 못했습니다.', 503);
                const input = validateFeedback(req.body || {});
                const requestOrigin = text(req.headers?.origin).replace(
                    /\/+$/,
                    ''
                );
                if (requestOrigin)
                    input.pageUrl = `${requestOrigin}/stock/${encodeURIComponent(input.symbol)}`;
                const current = now();
                const currentMs = current.getTime();
                const addressHash = createHash('sha256')
                    .update(`${secret}:${clientAddress(req)}`)
                    .digest('hex');
                const feedbackRef = db
                    .collection('stockFeedback')
                    .doc(input.requestId);
                const rateRef = db
                    .collection('stockFeedbackRateLimits')
                    .doc(addressHash);
                const result = await db.runTransaction(async (tx) => {
                    const [existing, rateSnapshot] = await Promise.all([
                        tx.get(feedbackRef),
                        tx.get(rateRef),
                    ]);
                    if (existing.exists)
                        return { id: input.requestId, duplicate: true };
                    const rate = rateSnapshot.exists ? rateSnapshot.data() : {};
                    const windowStart = Number(rate.windowStart || 0);
                    const activeWindow = currentMs - windowStart < 600_000;
                    const count = activeWindow ? Number(rate.count || 0) : 0;
                    if (count >= 3)
                        fail(
                            '짧은 시간에 여러 의견이 접수되었습니다. 잠시 후 다시 시도해 주세요.',
                            429
                        );
                    tx.set(feedbackRef, {
                        symbol: input.symbol,
                        category: input.category,
                        message: input.message,
                        pageUrl: input.pageUrl,
                        status: 'new',
                        internalNote: '',
                        createdAt: current.toISOString(),
                    });
                    tx.set(rateRef, {
                        windowStart: activeWindow ? windowStart : currentMs,
                        count: count + 1,
                        expiresAt: new Date(currentMs + 600_000),
                    });
                    return { id: input.requestId, duplicate: false };
                });
                return res.status(result.duplicate ? 200 : 201).json(result);
            }

            const claims = await verify(req, true);
            if (!isPortfolioAdmin(claims))
                fail('관리자만 종목 의견을 확인할 수 있습니다.', 403);
            if (req.method === 'GET') {
                const snapshot = await db
                    .collection('stockFeedback')
                    .orderBy('createdAt', 'desc')
                    .limit(200)
                    .get();
                return res.status(200).json({
                    feedback: snapshot.docs.map((doc) => ({
                        id: doc.id,
                        ...doc.data(),
                    })),
                });
            }
            if (req.method === 'PATCH') {
                const id = text(req.body?.id);
                const status = text(req.body?.status);
                const internalNote = text(req.body?.internalNote);
                if (!requestPattern.test(id))
                    fail('의견 항목을 확인해 주세요.');
                if (!feedbackStatuses.includes(status))
                    fail('처리 상태를 확인해 주세요.');
                if (internalNote.length > 1000)
                    fail('내부 메모는 1,000자까지 입력할 수 있습니다.');
                const ref = db.collection('stockFeedback').doc(id);
                const snapshot = await ref.get();
                if (!snapshot.exists) fail('의견을 찾을 수 없습니다.', 404);
                await ref.update({
                    status,
                    internalNote,
                    reviewedAt: now().toISOString(),
                    reviewedBy: claims.uid,
                });
                return res.status(200).json({ id, status });
            }
            fail('지원하지 않는 요청입니다.', 405);
        } catch (error) {
            if (!error.status)
                console.error('Stock feedback request failed', error);
            return res.status(error.status || 500).json({
                error: error.status
                    ? error.message
                    : '종목 의견을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            });
        }
    };
}
