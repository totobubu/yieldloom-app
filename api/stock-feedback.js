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

const instruments = new Map(
    catalog.instruments.map((row) => [row.symbol, row])
);
const collection = createApiHandler(
    stockCollectionHandler({
        verify: verifyFirebaseBearer,
        knownSymbol: (symbol) => instruments.has(symbol),
        marketForSymbol: (symbol) => instruments.get(symbol)?.market || '',
    }),
    { publicCors: true }
);
export default stockActionRouter({ feedback, collection });
