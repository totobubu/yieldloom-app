// Only the already-authorized masked identifier is used. Never read full account numbers.
export function capitalAccountLabel(account, owner) {
    const number =
        typeof account.maskedNumber === 'string' &&
        /^\*{2,}[- ]?\d{4}$/.test(account.maskedNumber)
            ? account.maskedNumber
            : '계좌번호 미등록';
    return `${String(owner || '').trim() || '예금주 미등록'} / ${String(account.institution || '').trim() || '증권사 미등록'} / ${number}`;
}
