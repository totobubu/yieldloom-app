import { createApiHandler } from '../lib/api-handler.js';
import { stockFeedbackHandler } from '../lib/stock-feedback.js';
import catalog from '../data-v2/catalog-seed.json' with { type: 'json' };
import { stockCollectionHandler } from '../lib/stock-collection.js';
import { stockActionRouter } from '../lib/stock-actions.js';
import {
    firebaseDatabase,
    verifyFirebaseBearer,
} from './_utils/firebase-auth.js';

const feedback = createApiHandler(
    stockFeedbackHandler({
        verify: verifyFirebaseBearer,
        database: firebaseDatabase,
    })
);

const symbols = new Set(catalog.instruments.map((row) => row.symbol));
const collection = createApiHandler(
    stockCollectionHandler({
        verify: verifyFirebaseBearer,
        knownSymbol: (symbol) => symbols.has(symbol),
    }),
    { publicCors: true }
);
export default stockActionRouter({ feedback, collection });
