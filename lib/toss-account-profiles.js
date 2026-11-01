// Public profile metadata contains references only. Never put credentials here.
export const tossAccountProfiles = Object.freeze([
    Object.freeze({
        id: 'wife-toss',
        ownerId: 'wife',
        brokerId: 'toss',
        label: '아내 · 토스',
        credentialPrefix: 'TOSS_WIFE',
    }),
    Object.freeze({
        id: 'husband-toss',
        ownerId: 'husband',
        brokerId: 'toss',
        label: '남편 · 토스',
        credentialPrefix: 'TOSS_HUSBAND',
    }),
]);
export function accountProfile(id) {
    const profile = tossAccountProfiles.find((p) => p.id === id);
    if (!profile) throw Error('unknown_account_profile');
    return profile;
}
export function resolveAccountProfile(id, references = {}) {
    const profile = accountProfile(id);
    const suffix = references[`${profile.credentialPrefix}_ACCOUNT_SUFFIX`];
    const accountNoSha256 =
        references[`${profile.credentialPrefix}_ACCOUNT_SHA256`];
    if (
        !/^\d{4}$/.test(suffix ?? '') ||
        !/^[a-f0-9]{64}$/.test(accountNoSha256 ?? '')
    )
        throw Error('profile_account_mapping_required');
    // Two slots cannot claim the same account. Do not guess which owner is correct.
    if (
        tossAccountProfiles.some(
            (other) =>
                other.id !== id &&
                references[`${other.credentialPrefix}_ACCOUNT_SHA256`] ===
                    accountNoSha256
        )
    )
        throw Error('ambiguous_profile_mapping');
    return { ...profile, suffix, accountNoSha256 };
}
export function profileCredentials(profile, references) {
    return Object.fromEntries(
        ['ACCESS_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET'].map((key) => [
            `TOSS_${key}`,
            references[`${profile.credentialPrefix}_${key}`],
        ])
    );
}
export function profileIndexPrefix(profile) {
    const metadata = accountProfile(profile.id);
    if (
        profile.ownerId !== metadata.ownerId ||
        profile.brokerId !== metadata.brokerId
    )
        throw Error('profile_account_mismatch');
    if (!/^[a-f0-9]{64}$/.test(profile.accountNoSha256 ?? ''))
        throw Error('profile_account_mapping_required');
    return `reconciliation/increments/v2/${profile.ownerId}/toss/${profile.accountNoSha256}/index/`;
}
export function validProfileBinding(binding) {
    try {
        const p = accountProfile(binding?.profileId);
        return (
            binding.ownerId === p.ownerId &&
            binding.brokerId === p.brokerId &&
            /^\d{4}$/.test(binding.suffix ?? '') &&
            /^[a-f0-9]{64}$/.test(binding.accountNoSha256 ?? '') &&
            /^[a-f0-9]{64}$/.test(binding.accountSeqSha256 ?? '')
        );
    } catch {
        return false;
    }
}
export function profileBinding(profile, accountSeqSha256) {
    const binding = {
        profileId: profile.id,
        ownerId: profile.ownerId,
        brokerId: profile.brokerId,
        suffix: profile.suffix,
        accountNoSha256: profile.accountNoSha256,
        accountSeqSha256,
    };
    if (!validProfileBinding(binding))
        throw Error('profile_account_mapping_required');
    return binding;
}
export function bindingIndexPrefix(binding) {
    if (!validProfileBinding(binding))
        throw Error('profile_account_mapping_required');
    return profileIndexPrefix({
        ...accountProfile(binding.profileId),
        accountNoSha256: binding.accountNoSha256,
    });
}
