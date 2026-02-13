import Constants from 'expo-constants';

type Extra = {
  apiBaseUrl?: string;
};

export const API_BASE_URL =
  (Constants.expoConfig?.extra as Extra | undefined)?.apiBaseUrl ??
  'https://iliagpt.com';
