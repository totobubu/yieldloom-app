const urls = [
    'http://127.0.0.1:5175',
    'http://127.0.0.1:5011/api/family-portfolio',
];
const deadline = Date.now() + 45000;
for (const url of urls) {
    let ready = false;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok || response.status === 401) {
                ready = true;
                break;
            }
        } catch {
            /* Startup can briefly refuse connections. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready)
        throw new Error(`Local test server did not become ready: ${url}`);
}
