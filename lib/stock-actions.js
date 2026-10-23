// Keep each action's authentication, cache and CORS policy in its own handler.
export function stockActionRouter({ feedback, collection }) {
    return (req, res) =>
        req.query?.action === 'collection'
            ? collection(req, res)
            : feedback(req, res);
}
