export const APP_MODES = {
    CONTENT_STUDIO: 'content-studio',
    LEGACY_PORTFOLIO: 'legacy-portfolio',
} as const;

export type AppMode = (typeof APP_MODES)[keyof typeof APP_MODES];

const configuredMode = String(
    import.meta.env.VITE_APP_MODE || APP_MODES.CONTENT_STUDIO
).trim();

export const appMode: AppMode =
    configuredMode === APP_MODES.LEGACY_PORTFOLIO
        ? APP_MODES.LEGACY_PORTFOLIO
        : APP_MODES.CONTENT_STUDIO;

export const isLegacyPortfolioEnabled = appMode === APP_MODES.LEGACY_PORTFOLIO;
