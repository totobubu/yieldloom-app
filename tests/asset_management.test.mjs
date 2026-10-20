import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick, ref } from 'vue';
import { useAssetManagement } from '../src/composables/useAssetManagement.js';
import { createFamilyPortfolioClient } from '../src/services/familyPortfolioClient.js';

test('pre-registration inspection does not invalidate an active ledger session', async () => {
    const user = { getIdToken: async () => 'fixture' };
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        fetcher: async () => new Response('{}'),
    });
    await request();
    let invalidations = 0;
    request.onInvalidate(() => invalidations++);
    await request('inspectAccountDocument', new FormData());
    assert.equal(invalidations, 0);
    await request('createAccount', {});
    assert.equal(invalidations, 2); // Existing writes invalidate before and after completion.
});

test('registration refreshes once and a changed login cannot register a pending account', async () => {
    const scope = effectScope();
    const user = ref({ uid: 'alice' });
    const families = ref([
        {
            id: 'personal',
            kind: 'personal',
            adminUid: 'alice',
            profiles: { self: { uid: 'alice', name: 'Alice' } },
        },
    ]);
    const accounts = ref([]);
    let refreshes = 0;
    const actions = [];
    let resolvePersonal;
    const state = scope.run(() =>
        useAssetManagement({
            user,
            families,
            accounts,
            refresh: async () => {
                refreshes++;
            },
            request: async (action, body) => {
                actions.push([action, body]);
                if (action === 'ensurePersonal')
                    return new Promise((resolve) => {
                        resolvePersonal = resolve;
                    });
                return { accountId: 'new', profileId: 'partner' };
            },
        })
    );
    await state.registerMember('Partner');
    assert.equal(refreshes, 1);
    assert.equal(actions[0][0], 'addManagedProfile');
    families.value = [];
    const pending = state.registerAccount({ alias: 'Pending' }, null);
    user.value = { uid: 'bob' };
    resolvePersonal({ familyId: 'personal', profileId: 'self' });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(
        actions.some(([action]) => action === 'createAccount'),
        false
    );
    scope.stop();
});

test('family selection is local, preserves origin identity and clears on logout', async () => {
    const scope = effectScope();
    const user = ref({ uid: 'alice', displayName: 'Alice' });
    const families = ref([
        {
            id: 'personal',
            profiles: {
                self: { name: 'Alice', uid: 'alice' },
                partner: { name: 'Partner', managerUid: 'alice' },
                linked: {
                    name: 'Child',
                    managerUid: 'alice',
                    sourceFamilyId: 'old',
                    sourceProfileId: 'child',
                },
            },
        },
        {
            id: 'old',
            profiles: { child: { name: 'Child', guardianUid: 'alice' } },
        },
    ]);
    const accounts = ref([
        { id: 'a', familyId: 'personal', ownerId: 'self' },
        { id: 'b', familyId: 'personal', ownerId: 'partner' },
        { id: 'c', familyId: 'old', ownerId: 'child' },
        { id: 'd', familyId: 'personal', ownerId: 'linked' },
    ]);
    const state = scope.run(() =>
        useAssetManagement({ user, families, accounts })
    );
    assert.equal(state.selectedProfile.value, 'personal:self');
    assert.equal(state.profiles.value.length, 3);
    state.selectedProfile.value = 'old:child';
    assert.deepEqual(
        state.memberAccounts.value.map((a) => a.id),
        ['c', 'd']
    );
    assert.equal(accounts.value.length, 4); // The overview receives the original full list.
    state.selectedProfile.value = 'personal:partner';
    assert.deepEqual(
        state.memberAccounts.value.map((a) => a.id),
        ['b']
    );
    families.value = families.value.filter((f) => f.id !== 'old');
    await nextTick();
    assert.equal(
        state.profiles.value.some((p) => p.key === 'personal:linked'),
        true
    );
    state.selectedProfile.value = 'personal:linked';
    assert.deepEqual(
        state.memberAccounts.value.map((a) => a.id),
        ['d']
    );
    state.uploadDialog.value = true;
    user.value = null;
    families.value = [];
    accounts.value = [];
    await nextTick();
    assert.equal(state.uploadDialog.value, false);
    assert.equal(state.memberAccounts.value.length, 0);
    scope.stop();
});
