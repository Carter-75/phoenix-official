// Central app config. Change these values, nothing else, when real accounts exist.

export const APP_CONFIG = {
  // Backend API base URL. Set EXPO_PUBLIC_API_URL at build time for production.
  // Local dev default expects the backend on port 4000 (Android emulator uses 10.0.2.2).
  apiUrl: (process.env.EXPO_PUBLIC_API_URL as string) || 'http://localhost:4000/api',

  // Google OAuth client IDs for expo-auth-session sign-in.
  // Carter fills these in after creating the OAuth clients (see store/CARTER-TODO.md).
  google: {
    webClientId: (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID as string) || '',
    androidClientId: (process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID as string) || '',
    iosClientId: (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID as string) || '',
  },
};
