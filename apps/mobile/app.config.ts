import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'IliaGPT',
  slug: 'iliagpt',
  scheme: 'iliagpt',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0f172a',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    // TODO: set to your Apple bundle identifier
    bundleIdentifier: 'com.iliagpt.app',
  },
  android: {
    // TODO: set to your Android applicationId
    package: 'com.iliagpt.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0f172a',
    },
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://iliagpt.com',
    eas: {
      projectId: '1583da88-4d23-4746-8707-71535377475b',
    },
  },
};

export default config;
