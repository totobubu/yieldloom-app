// api/_utils/api-handler.js

export function createApiHandler(handler) {
    return async function (req, res) {
        // [핵심] 허용할 Origin 목록. www 있고 없고 둘 다 포함되어야 함.
        const allowedOrigins = [
            'http://localhost:5173',
            'http://localhost:3000',
        ];
        const origin = req.headers.origin;

        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
        // Vercel 환경이 아니면서(로컬 개발 등) Origin 헤더가 없는 경우(Postman 등) '*'로 허용
        else if (!process.env.VERCEL && !origin) {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
        // 그 외의 경우는 CORS 헤더를 보내지 않음 (보안상 차단)

        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization'
        );

        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        try {
            await handler(req, res);
        } catch (error) {
            console.error(`[API Handler Error] Path: ${req.url}`, error);
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : 'An unknown server error occurred';
            res.status(500).json({
                error: 'Internal Server Error',
                details: errorMessage,
            });
        }
    };
}
