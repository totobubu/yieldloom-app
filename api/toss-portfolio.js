import { createApiHandler } from '../lib/api-handler.js';
import {
    firebaseDatabase,
    verifyFirebaseBearer,
} from './_utils/firebase-auth.js';
import {
    createAccountTossHandler,
    createUnavailableTossService,
    createRetiredTossHandler,
} from '../lib/account-toss-handler.js';
import { createLocalGrantSigner } from '../lib/toss-local-grants.js';
import { createTossLocalCloud } from '../lib/toss-local-cloud.js';
import { createFirestoreLocalRepository } from './_utils/toss-local-store.js';
import { ConnectionError } from '../lib/account-toss-connection.js';

const authenticate = (req) => verifyFirebaseBearer(req, true);
const retired = createRetiredTossHandler(authenticate);
// No production issuer, credentials, shared lock or connection store is wired.
const scoped = createAccountTossHandler({
    authenticate,
    service: createUnavailableTossService({
        loadAccount: async (id) =>
            (
                await firebaseDatabase()
                    .collection('investmentAccounts')
                    .doc(id)
                    .get()
            ).data(),
        loadFamily: async (id) =>
            (
                await firebaseDatabase()
                    .collection('familySpaces')
                    .doc(id)
                    .get()
            ).data(),
    }),
});
// Reuse the existing function slot (Vercel's twelve-function budget).
// Global credentials + caller-supplied accountSeq cannot establish account ACL.
export default createApiHandler(async (req, res) => {
    const local =
        (req.method === 'GET' && req.query.action === 'local-key') ||
        (req.method === 'POST' &&
            String(req.body?.action).startsWith('local-'));
    if (local) {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            if (process.env.TOSS_LOCAL_ENABLED !== '1')
                throw new ConnectionError('EXECUTION_NOT_CONFIGURED', 503);
            if (!process.env.TOSS_LOCAL_SIGNING_KEY)
                throw new ConnectionError('EXECUTION_NOT_CONFIGURED', 503);
            const signer = createLocalGrantSigner(
                process.env.TOSS_LOCAL_SIGNING_KEY
            );
            if (req.method === 'GET')
                return res.status(200).json(signer.publicKey);
            const service = createTossLocalCloud({
                repository: createFirestoreLocalRepository(firebaseDatabase()),
                signer,
            });
            if (req.body?.action === 'local-check') {
                if (
                    Object.keys(req.body).some(
                        (k) => !['action', 'grant'].includes(k)
                    )
                )
                    throw new ConnectionError('INVALID_REQUEST', 400);
                return res
                    .status(200)
                    .json(await service.check(req.body.grant));
            }
            const actor = await authenticate(req);
            return res.status(200).json(await service.act(actor, req.body));
        } catch (error) {
            return res
                .status(error instanceof ConnectionError ? error.status : 503)
                .json({
                    error:
                        error instanceof ConnectionError
                            ? error.code
                            : 'CONNECTION_UNAVAILABLE',
                });
        }
    }
    return req.method === 'GET' &&
        (req.query.action !== undefined || req.query.accountSeq !== undefined)
        ? retired(req, res)
        : scoped(req, res);
});
