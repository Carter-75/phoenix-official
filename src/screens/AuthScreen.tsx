import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { APP_CONFIG } from '../config/app.config';
import { api, ApiError } from '../services/api';
import { useGame } from '../state/GameContext';
import { BigButton, COLORS, Panel, ScreenShell } from '../components/ui';

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

type Mode = 'login' | 'register' | 'googleName';

export function AuthScreen() {
  const game = useGame();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [nameStatus, setNameStatus] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');
  const [accepted, setAccepted] = useState(game.progress.acceptedLegalPolicies);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const googleConfigured = !!(APP_CONFIG.google.webClientId || APP_CONFIG.google.androidClientId);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'phoenixofficial' });
  const [request, response, promptAsync] = Google.useAuthRequest(
    {
      webClientId: APP_CONFIG.google.webClientId || undefined,
      androidClientId: APP_CONFIG.google.androidClientId || undefined,
      iosClientId: APP_CONFIG.google.iosClientId || undefined,
      scopes: ['profile', 'email'],
      responseType: 'id_token',
      redirectUri,
    }
  );

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = (response.params as any)?.id_token || (response as any)?.authentication?.idToken;
    if (!idToken) {
      setError('Google did not return a sign-in token. Try again.');
      return;
    }
    (async () => {
      setBusy(true);
      setError('');
      try {
        const r = await api.google(idToken);
        if (r.needsUsername && r.pendingToken) {
          setPendingToken(r.pendingToken);
          setGoogleEmail(r.email || '');
          setMode('googleName');
        } else if (r.user && r.token) {
          if (accepted && !r.user.acceptedLegalPolicies) game.setAcceptedPolicies(true);
          await game.signInWithSession(r.user, r.token);
          game.go('profile');
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Google sign-in failed.');
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  // Live username check while registering.
  useEffect(() => {
    if (mode === 'login' || username.trim().length < 3) {
      setNameStatus('');
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.usernameAvailable(username.trim());
        setNameStatus(r.available ? 'That name is available.' : r.reason || 'That name is taken.');
      } catch {
        setNameStatus('');
      }
    }, 500);
    return () => clearTimeout(t);
  }, [username, mode]);

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

  const onLogin = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.login(email.trim(), password);
      await game.signInWithSession(r.user, r.token);
      game.go('profile');
    } catch (e) {
      fail(e, 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    if (!accepted) {
      setError('Please accept the Terms and Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.register(email.trim(), password, username.trim(), accepted);
      await game.signInWithSession(r.user, r.token);
      game.go('profile');
    } catch (e) {
      fail(e, 'Sign up failed.');
    } finally {
      setBusy(false);
    }
  };

  const onGoogleComplete = async () => {
    if (!accepted) {
      setError('Please accept the Terms and Privacy Policy to finish signup.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.googleComplete(pendingToken, username.trim(), accepted);
      await game.signInWithSession(r.user, r.token);
      game.go('profile');
    } catch (e) {
      fail(e, 'Signup failed. The session may have expired, try Google sign-in again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title={mode === 'googleName' ? 'Pick Your Name' : 'Account'} subtitle="Accounts save your progress to the cloud and put you on the leaderboards. Guest play always works too." onBack={() => game.go('menu')}>
      {mode !== 'googleName' && (
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, mode === 'login' && styles.tabActive]} onPress={() => { setMode('login'); setError(''); }}>
            <Text style={styles.tabText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, mode === 'register' && styles.tabActive]} onPress={() => { setMode('register'); setError(''); }}>
            <Text style={styles.tabText}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      )}

      <Panel>
        {mode === 'googleName' ? (
          <>
            <Text style={styles.label}>Google account {googleEmail} is new here. Pick the display name other players will see on the leaderboards.</Text>
            <TextInput style={styles.input} placeholder="Display name (3-16 letters, numbers, _)" placeholderTextColor="#7d739e" value={username} onChangeText={setUsername} autoCapitalize="none" />
            {nameStatus ? <Text style={styles.status}>{nameStatus}</Text> : null}
          </>
        ) : (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor="#7d739e" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} placeholderTextColor="#7d739e" value={password} onChangeText={setPassword} secureTextEntry />
            {mode === 'register' && (
              <>
                <Text style={styles.label}>Display name (shown on leaderboards)</Text>
                <TextInput style={styles.input} placeholder="3-16 letters, numbers, or _" placeholderTextColor="#7d739e" value={username} onChangeText={setUsername} autoCapitalize="none" />
                {nameStatus ? <Text style={styles.status}>{nameStatus}</Text> : null}
              </>
            )}
          </>
        )}

        <TouchableOpacity style={styles.checkRow} onPress={() => setAccepted(!accepted)}>
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>{accepted && <Text style={styles.checkMark}>X</Text>}</View>
          <Text style={styles.checkText}>I accept the Terms of Service and Privacy Policy (in Settings).</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {mode === 'login' && <BigButton label={busy ? 'Signing in...' : 'Sign In'} disabled={busy} onPress={onLogin} />}
        {mode === 'register' && <BigButton label={busy ? 'Creating account...' : 'Create Account'} disabled={busy} onPress={onRegister} />}
        {mode === 'googleName' && <BigButton label={busy ? 'Finishing...' : 'Finish Signup'} disabled={busy} onPress={onGoogleComplete} />}

        {mode !== 'googleName' && (
          <>
            <Text style={styles.or}>or</Text>
            {googleConfigured ? (
              <BigButton label="Continue with Google" color="#2d2154" disabled={!request || busy} onPress={() => promptAsync()} />
            ) : (
              <Text style={styles.dimNote}>Google sign-in turns on once the Google OAuth client IDs are added (see the setup list). Email accounts work right now.</Text>
            )}
          </>
        )}
      </Panel>
      <Text style={styles.dimNote}>Your guest progress on this device carries over when you create an account. Nothing is lost.</Text>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: { flex: 1, backgroundColor: COLORS.panel, borderColor: COLORS.panelEdge, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  tabActive: { borderColor: COLORS.fire, backgroundColor: '#3a1503' },
  tabText: { color: COLORS.text, fontWeight: '700' },
  label: { color: COLORS.dim, fontSize: 13, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: '#0b0620', borderColor: COLORS.panelEdge, borderWidth: 1, borderRadius: 10, color: COLORS.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  status: { color: COLORS.good, fontSize: 12.5, marginTop: 5 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: COLORS.panelEdge, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: COLORS.fire, borderColor: COLORS.fire },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 12 },
  checkText: { color: COLORS.dim, fontSize: 12.5, flex: 1 },
  error: { color: COLORS.bad, fontSize: 13.5, marginTop: 10 },
  or: { color: COLORS.dim, textAlign: 'center', marginVertical: 6 },
  dimNote: { color: COLORS.dim, fontSize: 12.5, marginTop: 8, lineHeight: 17 },
});
