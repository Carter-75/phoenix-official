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
      androidClientId: '108585498879-o171u9a80ssqfkojpd8hohgq6dumk0iu.apps.googleusercontent.com',
      forceCodeForRefreshToken: true
    }
  }
};

export default config;
