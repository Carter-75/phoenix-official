import React, { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import { APP_CONFIG } from '../config/app.config';
import { api, ApiError } from '../services/api';
import { campaignScore } from '../state/types';
import { useGame } from '../state/GameContext';
import { BigButton, COLORS, Panel, ScreenShell } from '../components/ui';

export function ProfileScreen() {
  const game = useGame();
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const discovery = {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  };
  const [request, response, promptAsync] = Google.useAuthRequest(
    {
      webClientId: APP_CONFIG.google.webClientId || undefined,
      androidClientId: APP_CONFIG.google.androidClientId || undefined,
      iosClientId: APP_CONFIG.google.iosClientId || undefined,
      scopes: ['profile', 'email'],
      responseType: 'id_token',
      redirectUri: AuthSession.makeRedirectUri({ scheme: 'phoenixofficial' }),
    }
  );

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = (response.params as any)?.id_token;
    if (!idToken) return;
    (async () => {
      setBusy(true);
      try {
        const r = await api.linkGoogle(idToken);
        await game.refreshAccount().catch(() => {});
        setMsg('Google is now linked to this account. You can sign in either way.');
        void r;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Linking failed.');
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  if (!game.account) {
    return (
      <ScreenShell title="Profile" onBack={() => game.go('menu')}>
        <Text style={styles.dim}>You are playing as a guest. Sign in to get a profile, cloud saves, and leaderboard spots.</Text>
        <BigButton label="Sign In / Sign Up" onPress={() => game.go('auth')} />
      </ScreenShell>
    );
  }

  const p = game.progress;
  const a = game.account;

  const confirm = (title: string, body: string, onYes: () => void) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${body}`)) onYes();
    } else {
      Alert.alert(title, body, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, do it', style: 'destructive', onPress: onYes },
      ]);
    }
  };

  const onSetPassword = async () => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await api.setPassword(password, a.hasPassword ? currentPassword : undefined);
      await game.refreshAccount().catch(() => {});
      setPassword('');
      setCurrentPassword('');
      setMsg('Password saved. You can now sign in with email and password too.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title={a.username} subtitle={a.email || 'Google account'} onBack={() => game.go('menu')}>
      <Panel>
        <Text style={styles.section}>Progress</Text>
        <Text style={styles.dim}>
          Level {p.level} - XP {p.xp}/{p.xpToNext} - Campaign score {campaignScore(p)} - Worlds cleared {p.worldBests.filter((w) => w.completed).length}/10
        </Text>
        <Text style={styles.dim}>
          Battle: {p.battleWins} wins, {p.battleLosses} losses, rating {p.battleRating}, best {p.battleBestScore}
        </Text>
        <Text style={styles.dim}>
          Moves owned {p.movePackAll ? 75 : p.ownedMoves.length}/75 - Trophies {p.trophies.length} - Deaths {p.deathCount}
        </Text>
        <BigButton small label="Sync Progress Now" color="#2d2154" onPress={async () => { await game.syncNow(); setMsg('Progress synced to your account.'); }} />
      </Panel>

      <Panel>
        <Text style={styles.section}>Sign-in methods</Text>
        <Text style={styles.dim}>Email and password: {a.hasPassword ? 'On' : 'Off'}</Text>
        <Text style={styles.dim}>Google: {a.hasGoogle ? 'Linked' : 'Not linked'}</Text>
        {!a.hasGoogle && (APP_CONFIG.google.webClientId || APP_CONFIG.google.androidClientId) ? (
          <BigButton small label={busy ? 'Working...' : 'Link Google'} color="#2d2154" disabled={!request || busy} onPress={() => promptAsync()} />
        ) : null}
        <Text style={styles.label}>{a.hasPassword ? 'Change password' : 'Add a password'}</Text>
        {a.hasPassword && (
          <TextInput style={styles.input} placeholder="Current password" placeholderTextColor="#7d739e" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        )}
        <TextInput style={styles.input} placeholder="New password (8+ characters)" placeholderTextColor="#7d739e" value={password} onChangeText={setPassword} secureTextEntry />
        <BigButton small label={busy ? 'Saving...' : 'Save Password'} disabled={busy || password.length < 8} onPress={onSetPassword} />
      </Panel>

      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <BigButton
        label="Sign Out"
        color="#2d2154"
        onPress={async () => {
          await game.signOut();
          game.go('menu');
        }}
      />
      <BigButton
        label="Delete Account"
        color="#7a1020"
        onPress={() =>
          confirm('Delete your account?', 'This permanently deletes your account, cloud progress, and leaderboard spots. Local guest progress on this device resets too. This cannot be undone.', async () => {
            try {
              await game.deleteAccount();
              game.go('menu');
            } catch (e) {
              setError('Account deletion failed. Check your connection and try again.');
            }
          })
        }
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  section: { color: COLORS.text, fontWeight: '800', fontSize: 16, marginBottom: 6 },
  dim: { color: COLORS.dim, fontSize: 13.5, marginVertical: 3, lineHeight: 18 },
  label: { color: COLORS.dim, fontSize: 13, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: '#0b0620', borderColor: COLORS.panelEdge, borderWidth: 1, borderRadius: 10, color: COLORS.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, marginBottom: 8 },
  msg: { color: COLORS.good, fontSize: 13.5, marginVertical: 6 },
  error: { color: COLORS.bad, fontSize: 13.5, marginVertical: 6 },
});
