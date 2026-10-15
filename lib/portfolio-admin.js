export const PORTFOLIO_ADMIN_EMAILS = [
    'jomalkeun@gmail.com',
    'totobubu.lab@gmail.com',
];

export function isPortfolioAdmin(user) {
    return Boolean(
        user &&
            (user.emailVerified === true || user.email_verified === true) &&
            PORTFOLIO_ADMIN_EMAILS.includes(
                String(user.email || '').toLowerCase()
            )
    );
}
