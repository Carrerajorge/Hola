import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaView, Text, View } from 'react-native';
import { API_BASE_URL } from './src/config';

type Health = { status: string; timestamp?: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/health`);
        const json = (await res.json()) as Health;
        setHealth(json);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    };

    run();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
      <View style={{ flex: 1, padding: 20, gap: 12 }}>
        <Text style={{ color: 'white', fontSize: 24, fontWeight: '700' }}>
          Iliagpt Mobile
        </Text>
        <Text style={{ color: '#cbd5e1' }}>API: {API_BASE_URL}</Text>

        {health ? (
          <Text style={{ color: '#86efac' }}>
            Health: {health.status} {health.timestamp ? `(${health.timestamp})` : ''}
          </Text>
        ) : null}

        {error ? (
          <Text style={{ color: '#fca5a5' }}>Error: {error}</Text>
        ) : null}

        <Text style={{ color: '#94a3b8', marginTop: 16 }}>
          Next: Auth (Google/Microsoft), Push, Camera, Offline.
        </Text>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}
