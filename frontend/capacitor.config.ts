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
      serverClientId: '108585498879-v35d0d196d4djglodbbjok452pr1e04r.apps.googleusercontent.com',
      // The Android plugin passes clientId to requestIdToken, which must be
      // the WEB client. An androidClientId here wins over it and makes every
      // native sign-in fail with DEVELOPER_ERROR (10). The Android OAuth
      // client is matched by package name plus signing SHA-1, not by id.
      clientId: '108585498879-v35d0d196d4djglodbbjok452pr1e04r.apps.googleusercontent.com',
      forceCodeForRefreshToken: true
    }
  }
};

export default config;
