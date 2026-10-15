import admin from 'firebase-admin';
import { parseFirebaseCredential } from '../../lib/firebase-credential.js';

function firebaseApp() {
    if (admin.apps.length) return admin.app();
    const raw = process.env.FIRESTORE_SA_KEY;
    if (!raw) throw new Error('FIRESTORE_SA_KEY is not configured');
    return admin.initializeApp({
        credential: admin.credential.cert(parseFirebaseCredential(raw)),
    });
}

export async function verifyFirebaseBearer(req, checkRevoked = false) {
    const header = String(req.headers.authorization ?? '');
    if (!header.startsWith('Bearer ')) {
        const error = new Error('로그인이 확인되지 않았습니다.');
        error.status = 401;
        throw error;
    }
    return admin.auth(firebaseApp()).verifyIdToken(header.slice(7), checkRevoked);
}

export function requireAllowedTossUser(claims) {
    const allowed = String(process.env.TOSS_PORTFOLIO_ALLOWED_EMAILS ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    if (!allowed.length) {
        const error = new Error(
            'Toss API 계정 조회가 아직 활성화되지 않았습니다.'
        );
        error.status = 503;
        throw error;
    }
    if (
        !claims.email ||
        !allowed.includes(String(claims.email).toLowerCase())
    ) {
        const error = new Error('이 계정에는 Toss API 조회 권한이 없습니다.');
        error.status = 403;
        throw error;
    }
}
