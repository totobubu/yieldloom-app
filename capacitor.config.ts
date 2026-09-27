import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.divgrow.app',
    appName: '배당모아 DivGrow',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
    },
    android: {
        buildOptions: {
            keystorePath: undefined,
            keystoreAlias: undefined,
        },
    },
};

export default config;
