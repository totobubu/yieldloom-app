import { computed, ref, watch } from 'vue';

// Selection is local presentation state; switching people never fetches data.
export function useAssetManagement({
    families,
    accounts,
    user,
    request,
    refresh,
}) {
    const selectedProfile = ref('');
    const memberDialog = ref(false);
    const accountDialog = ref(false);
    const uploadDialog = ref(false);
    const hasOrigin = (profile) =>
        !!profile?.sourceProfileId &&
        !!families.value.find((f) => f.id === profile.sourceFamilyId)
            ?.profiles?.[profile.sourceProfileId];
    function accountProfileKey(account) {
        const owner = families.value.find((f) => f.id === account.familyId)
            ?.profiles?.[account.ownerId];
        return hasOrigin(owner)
            ? `${owner.sourceFamilyId}:${owner.sourceProfileId}`
            : `${account.familyId}:${account.ownerId}`;
    }
    const profiles = computed(() => {
        const result = families.value.flatMap((family) =>
            Object.entries(family.profiles || {}).map(([id, profile]) => ({
                ...profile,
                id,
                familyId: family.id,
                personal: family.kind === 'personal',
                key: `${family.id}:${id}`,
                manageable: [
                    profile.uid,
                    profile.guardianUid,
                    profile.managerUid,
                ].includes(user.value?.uid),
            }))
        );
        const people = result.filter((p) => !hasOrigin(p));
        if (!people.some((p) => p.uid === user.value?.uid))
            people.unshift({
                id: '',
                familyId: '',
                key: 'self',
                name: user.value?.displayName || '본인',
                uid: user.value?.uid,
                manageable: true,
            });
        return people.sort(
            (a, b) =>
                Number(b.uid === user.value?.uid) * (b.personal ? 2 : 1) -
                Number(a.uid === user.value?.uid) * (a.personal ? 2 : 1)
        );
    });
    const selectedMember = computed(() =>
        profiles.value.find((p) => p.key === selectedProfile.value)
    );
    const memberAccounts = computed(() =>
        accounts.value.filter(
            (a) => accountProfileKey(a) === selectedProfile.value
        )
    );
    watch(
        profiles,
        (people) => {
            if (!people.some((p) => p.key === selectedProfile.value))
                selectedProfile.value =
                    people.find((p) => p.uid === user.value?.uid)?.key ||
                    people[0]?.key ||
                    '';
        },
        { immediate: true }
    );
    watch(
        user,
        () => {
            selectedProfile.value = '';
            memberDialog.value =
                accountDialog.value =
                uploadDialog.value =
                    false;
        },
        { flush: 'sync' }
    );
    async function personal() {
        const family = families.value.find(
            (f) => f.kind === 'personal' && f.adminUid === user.value?.uid
        );
        if (family)
            return {
                familyId: family.id,
                profileId: Object.entries(family.profiles).find(
                    ([, p]) => p.uid === user.value?.uid
                )?.[0],
            };
        return request('ensurePersonal', {
            profileName: user.value?.displayName || '본인',
        });
    }
    function check(current) {
        if (!current || user.value !== current)
            throw new DOMException(
                '로그인 상태가 변경되었습니다.',
                'AbortError'
            );
    }
    async function registerMember(name) {
        const current = user.value;
        check(current);
        const target = await personal();
        check(current);
        const result = await request('addManagedProfile', {
            familyId: target.familyId,
            name,
        });
        check(current);
        await refresh();
        check(current);
        selectedProfile.value = `${target.familyId}:${result.profileId}`;
    }
    async function registerAccount(form, member) {
        const current = user.value;
        check(current);
        const target = await personal();
        check(current);
        let ownerId = member?.familyId === target.familyId ? member.id : null;
        if (!ownerId) {
            if (!member || member.uid === current.uid)
                ownerId = target.profileId;
            else {
                const result = await request('addManagedProfile', {
                    familyId: target.familyId,
                    name: member.name,
                    sourceFamilyId: member.familyId,
                    sourceProfileId: member.id,
                });
                check(current);
                ownerId = result.profileId;
            }
        }
        const result = await request('createAccount', {
            ...form,
            familyId: target.familyId,
            ownerId,
        });
        check(current);
        await refresh();
        check(current);
        selectedProfile.value =
            member &&
            member.uid !== current.uid &&
            member.familyId !== target.familyId
                ? member.key
                : `${target.familyId}:${ownerId}`;
        return result;
    }
    return {
        profiles,
        selectedProfile,
        selectedMember,
        memberAccounts,
        memberDialog,
        accountDialog,
        uploadDialog,
        registerMember,
        registerAccount,
        accountProfileKey,
    };
}
