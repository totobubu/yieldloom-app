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
export default createApiHandler((req, res) =>
    req.method === 'GET' &&
    (req.query.action !== undefined || req.query.accountSeq !== undefined)
        ? retired(req, res)
        : scoped(req, res)
);
