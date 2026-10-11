export function normalizeFrequency(value) {
    const aliases = { '매주': 'weekly', '주': 'weekly', '주배당': 'weekly', '매월': 'monthly', '월': 'monthly', '월배당': 'monthly', '분기': 'quarterly', '분기배당': 'quarterly', '반기': 'semiannual', '매년': 'annual', '연': 'annual' };
    const key = String(value ?? '').trim().toLowerCase();
    return aliases[key] ?? (['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'].includes(key) ? key : null);
}
