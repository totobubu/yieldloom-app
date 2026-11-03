import { ConnectionError } from './account-toss-connection.js';

export function createUnavailableTossService({ loadAccount, loadFamily }) {
    async function state(actor, accountId) {
        if (typeof accountId !== 'string' || !/^[\w-]{1,100}$/.test(accountId))
            throw new ConnectionError('INVALID_REQUEST', 400);
        const account = await loadAccount(accountId);
        if (
            !account ||
            !['owner', 'editor', 'viewer'].includes(
                account.permissions?.[actor.uid]
            )
        )
            throw new ConnectionError('ACCESS_DENIED', 403);
        const family = await loadFamily(account.familyId);
        if (!family?.participantUids?.includes(actor.uid))
            throw new ConnectionError('ACCESS_DENIED', 403);
        return {
            status: 'execution_not_configured',
            mode: 'disabled',
            revision: 0,
            canManage: false,
            options: [],
        };
    }
    return {
        state,
        async act(actor, input) {
            await state(actor, input.accountId);
            throw new ConnectionError('EXECUTION_NOT_CONFIGURED', 503);
        },
    };
}

export function createRetiredTossHandler(authenticate) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        if (req.method !== 'GET')
            return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
        try {
            if (!(await authenticate(req))?.uid) throw Error();
            return res
                .status(410)
                .json({ error: 'ACCOUNT_SCOPED_CONNECTION_REQUIRED' });
        } catch {
            return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
        }
    };
}

export function createAccountTossHandler({ authenticate, service }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Pragma', 'no-cache');
        try {
            if (!['GET', 'POST'].includes(req.method))
                throw new ConnectionError('METHOD_NOT_ALLOWED', 405);
            const actor = await authenticate(req);
            if (!actor?.uid)
                throw new ConnectionError('AUTHENTICATION_REQUIRED', 401);
            const input = req.method === 'GET' ? req.query : req.body;
            if (!input || typeof input !== 'object' || Array.isArray(input))
                throw new ConnectionError('INVALID_REQUEST', 400);
            if (
                req.method === 'GET' &&
                Object.keys(input).some((k) => k !== 'accountId')
            )
                throw new ConnectionError('INVALID_REQUEST', 400);
            const result =
                req.method === 'GET'
                    ? await service.state(actor, input.accountId)
                    : await service.act(actor, input);
            res.status(200).json(result);
        } catch (error) {
            // Do not reflect provider/Firebase errors, request bodies or identifiers.
            res.status(
                error instanceof ConnectionError ? error.status : 503
            ).json({
                error:
                    error instanceof ConnectionError
                        ? error.code
                        : 'CONNECTION_UNAVAILABLE',
            });
        }
    };
}
