import { watch } from 'vue';
import { firebaseUser } from './firebaseClient.js';
import { createAccountTossClient } from './accountTossClient.js';
export const accountToss = createAccountTossClient({
    getUser: () => firebaseUser.value,
});
watch(firebaseUser, () => accountToss.clear(), { flush: 'sync' });
