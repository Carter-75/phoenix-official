import React, { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useGame } from '../state/GameContext';
import { BigButton, COLORS, Panel, ScreenShell } from '../components/ui';

const PRIVACY = `Privacy Policy - Phoenix: Rise of the Flame

What we collect: if you create an account, your email address, a display name you choose, and your game progress (scores, levels, purchases of in-game items). If you play as a guest, progress stays on your device.

What we never collect: your real name, address, contacts, photos, or location. Passwords are stored only as salted hashes.

Ads and purchases: the game shows ads through Google AdMob and sells digital goods through Google Play Billing. Google processes those under its own policies. Buying Remove Ads stops interstitial ads; optional rewarded ads remain available only when you choose to watch them.

Data sharing: we do not sell personal data. Leaderboard display names and scores are public inside the game by design.

Deletion: you can delete your account and all cloud data any time in Profile - Delete Account. Guest data is removed by resetting progress here or uninstalling.

Contact: hello@phoenixwebsites.ai`;

const TERMS = `Terms of Service - Phoenix: Rise of the Flame

The game is free to play with optional ads and in-app purchases handled by Google Play. Virtual coins, gems, moves, and skins have no cash value and cannot be transferred or refunded outside Google Play's own refund process.

Play fair: cheating, exploiting bugs to inflate leaderboard scores, or automating play may result in score removal or account closure.

Accounts: keep your password private. You are responsible for activity on your account. One person, one account per leaderboard identity.

The game is provided as is. Progress sync is best-effort; keep playing on one device at a time for the cleanest sync.`;

export function SettingsScreen() {
  const game = useGame();
  const [showLegal, setShowLegal] = useState<'privacy' | 'terms' | null>(null);
  const [msg, setMsg] = useState('');
  const s = game.progress.settings;

  const confirmReset = () => {
    const run = async () => {
      await game.resetAllProgress();
      setMsg('Progress reset on this device.');
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Reset all progress on this device? This cannot be undone.')) run();
    } else {
      Alert.alert('Reset progress?', 'This wipes local progress on this device. Signed-in cloud progress re-syncs on next sign-in.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: run },
      ]);
    }
  };

  return (
    <ScreenShell title="Settings" onBack={() => game.go('menu')} scroll={!showLegal}>
      <Panel>
        <View style={styles.row}>
          <Text style={styles.label}>Sound effects</Text>
          <Switch value={s.soundEnabled} onValueChange={(v) => game.updateSettings({ soundEnabled: v })} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Music</Text>
          <Switch value={s.musicEnabled} onValueChange={(v) => game.updateSettings({ musicEnabled: v })} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Haptics (vibration)</Text>
          <Switch value={s.hapticsEnabled} onValueChange={(v) => game.updateSettings({ hapticsEnabled: v })} />
        </View>
      </Panel>

      <Panel>
        <Text style={styles.section}>Legal</Text>
        <Text style={styles.dim}>Policy status: {game.progress.acceptedLegalPolicies ? 'Accepted' : 'Not accepted yet'}</Text>
        {!game.progress.acceptedLegalPolicies && (
          <BigButton small label="Accept Terms and Privacy Policy" onPress={() => { game.setAcceptedPolicies(true); setMsg('Policies accepted. Thank you.'); }} />
        )}
        <BigButton small label="Read Privacy Policy" color="#2d2154" onPress={() => setShowLegal('privacy')} />
        <BigButton small label="Read Terms of Service" color="#2d2154" onPress={() => setShowLegal('terms')} />
      </Panel>

      {showLegal && (
        <Panel>
          <ScrollView style={{ maxHeight: 320 }}>
            <Text style={styles.legal}>{showLegal === 'privacy' ? PRIVACY : TERMS}</Text>
          </ScrollView>
          <BigButton small label="Close" color="#2d2154" onPress={() => setShowLegal(null)} />
        </Panel>
      )}

      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      <Panel>
        <Text style={styles.section}>Controls recap</Text>
        <Text style={styles.dim}>Drag anywhere to steer your phoenix. Double tap (or DOUBLE) fires your double move. Triple tap (or TRIPLE) fires your triple move. Press and hold HOLD to channel your hold move.</Text>
      </Panel>

      <BigButton label="Reset Local Progress" color="#7a1020" onPress={confirmReset} />
      <Text style={styles.version}>Phoenix: Rise of the Flame - version 1.0.0 - Made by Phoenix Websites AI</Text>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  label: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  section: { color: COLORS.text, fontWeight: '800', fontSize: 16, marginBottom: 6 },
  dim: { color: COLORS.dim, fontSize: 13, lineHeight: 18 },
  legal: { color: COLORS.dim, fontSize: 12.5, lineHeight: 17 },
  msg: { color: COLORS.good, fontSize: 13.5, marginVertical: 6 },
  version: { color: COLORS.dim, fontSize: 11.5, textAlign: 'center', marginTop: 14 },
});
