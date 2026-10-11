export function createApiHandler(handler) {
    return async function (req, res) {
        const allowedOrigins = [
            'http://localhost:5173',
            'http://localhost:3000',
        ];
        const origin = req.headers.origin;

        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else if (!process.env.VERCEL && !origin) {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }

        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') return res.status(200).end();

        try {
            await handler(req, res);
        } catch (error) {
            console.error(`[API Handler Error] Path: ${req.url}`, error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error instanceof Error ? error.message : 'An unknown server error occurred',
            });
        }
    };
}
