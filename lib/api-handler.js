export function createApiHandler(handler, { publicCors = false } = {}) {
    return async function (req, res) {
        const allowedOrigins = [
            'http://localhost:5173',
            'http://localhost:3000',
            'https://totobubu.github.io',
            ...String(process.env.PUBLIC_APP_ORIGINS ?? '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
        ];
        const origin = req.headers.origin;

        // Anonymous public responses must have the same CORS header before and
        // after a CDN hit. Vercel's cache does not vary by arbitrary Origin.
        // Authenticated routes retain the explicit origin allowlist below.
        if (publicCors) {
            res.setHeader('Access-Control-Allow-Origin', '*');
        } else if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        } else if (!process.env.VERCEL && !origin) {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }

        res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, PATCH, OPTIONS'
        );
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization'
        );

        if (req.method === 'OPTIONS') return res.status(200).end();

        try {
            await handler(req, res);
        } catch (error) {
            console.error(`[API Handler Error] Path: ${req.url}`, error);
            res.status(500).json({
                error: 'Internal Server Error',
                details:
                    error instanceof Error
                        ? error.message
                        : 'An unknown server error occurred',
            });
        }
    };
}
