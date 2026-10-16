import { firebaseUser } from './firebaseClient';
import { createFamilyPortfolioClient } from './familyPortfolioClient.js';

export const familyRequest = createFamilyPortfolioClient({
    getUser: () => firebaseUser.value,
});
