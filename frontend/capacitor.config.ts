import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.phoenix.fall',
  appName: 'PhoenixFall',
  // Angular application builder emits static files under dist/<project>/browser
  webDir: 'dist/frontend/browser',
  plugins: {
    CapacitorCookies: {
      enabled: true,
    },
    CapacitorHttp: {
      enabled: true,
    },
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '396962735048-u6ke75eh6ir3qt6umnpj0s8mk7ubfhh1.apps.googleusercontent.com',
      // The Android plugin passes clientId to requestIdToken, which must be
      // the WEB client. An androidClientId here wins over it and makes every
      // native sign-in fail with DEVELOPER_ERROR (10). The Android OAuth
      // client is matched by package name plus signing SHA-1, not by id.
      clientId: '396962735048-u6ke75eh6ir3qt6umnpj0s8mk7ubfhh1.apps.googleusercontent.com',
      forceCodeForRefreshToken: true
    }
  }
};

export default config;
