import { createApiHandler } from '../lib/api-handler.js';
import { stockFeedbackHandler } from '../lib/stock-feedback.js';
import {
    firebaseDatabase,
    verifyFirebaseBearer,
} from './_utils/firebase-auth.js';

export default createApiHandler(
    stockFeedbackHandler({
        verify: verifyFirebaseBearer,
        database: firebaseDatabase,
    })
);
