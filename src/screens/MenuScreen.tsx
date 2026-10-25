import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SKIN_BY_ID } from '../data/catalog';
import { PhoenixSprite } from '../game/PhoenixSprite';
import { useMonetization } from '../services/monetization';
import { useGame } from '../state/GameContext';
import { hasActiveBoost } from '../state/types';
import { BigButton, COLORS, Panel } from '../components/ui';

export function MenuScreen() {
  const game = useGame();
  const monetization = useMonetization();
  const p = game.progress;
  const skin = SKIN_BY_ID[p.activeSkin] || SKIN_BY_ID.ember;
  const xpPct = Math.min(100, (p.xp / p.xpToNext) * 100);
  const boosted = hasActiveBoost(p);

  const onBoost = async () => {
    const ok = await monetization.showRewarded('boost');
    if (ok) game.activateBoost();
  };

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <PhoenixSprite skin={skin} size={92} flap={0.5} />
        <Text style={styles.title}>PHOENIX</Text>
        <Text style={styles.subtitle}>Rise of the Flame</Text>
        <Text style={styles.accountLine}>
          {game.account ? `Welcome back, ${game.account.username}` : 'Playing as guest - sign in to save progress to the cloud and join the leaderboards'}
        </Text>
      </View>

      <Panel>
        <View style={styles.rowBetween}>
          <Text style={styles.stat}>Level {p.level}</Text>
          <Text style={styles.stat}>Coins {p.coins}</Text>
          <Text style={styles.stat}>Gems {p.gems}</Text>
        </View>
        <View style={styles.xpBg}>
          <View style={[styles.xpFill, { width: `${xpPct}%` }]} />
        </View>
        <Text style={styles.dim}>
          XP {p.xp}/{p.xpToNext} - Worlds cleared {p.worldBests.filter((w) => w.completed).length}/10 - Battle rating {p.battleRating}
          {boosted ? ' - 2x BOOST ACTIVE' : ''}
        </Text>
        {game.serverOnline === false && <Text style={styles.warn}>Game server offline - playing locally, progress will sync when it is back.</Text>}
      </Panel>

      <BigButton label="Play - World Select" onPress={() => { game.click(); game.go('worlds'); }} />
      <BigButton label="Battle Mode - vs AI Phoenix" color="#7a2be2" onPress={() => { game.click(); game.go('battle'); }} />
      <View style={styles.grid}>
        <View style={styles.gridCol}>
          <BigButton small label="Move Shop" color="#2d2154" onPress={() => { game.click(); game.go('shop'); }} />
          <BigButton small label="Skins" color="#2d2154" onPress={() => { game.click(); game.go('skins'); }} />
          <BigButton small label="Leaderboards" color="#2d2154" onPress={() => { game.click(); game.go('leaderboard'); }} />
          <BigButton small label="Codex" color="#2d2154" onPress={() => { game.click(); game.go('codex'); }} />
        </View>
        <View style={styles.gridCol}>
          <BigButton small label="Gem and Coin Store" color="#2d2154" onPress={() => { game.click(); game.go('store'); }} />
          <BigButton small label={game.account ? 'Profile' : 'Sign In / Sign Up'} color="#2d2154" onPress={() => { game.click(); game.go(game.account ? 'profile' : 'auth'); }} />
          <BigButton small label="Trophies" color="#2d2154" onPress={() => { game.click(); game.go('trophies'); }} />
          <BigButton small label="Settings" color="#2d2154" onPress={() => { game.click(); game.go('settings'); }} />
        </View>
      </View>
      {!boosted && <BigButton label="Watch Ad - 2x Coins and XP for 5 Minutes" color="#0a7a3d" onPress={onBoost} />}
      {monetization.testMode && <Text style={styles.testNote}>Ads and purchases are in TEST mode until real AdMob and Play IDs are added.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 18, paddingTop: 26, width: '100%', maxWidth: 560, alignSelf: 'center' },
  hero: { alignItems: 'center', marginBottom: 10 },
  title: { color: COLORS.gold, fontSize: 44, fontWeight: '900', letterSpacing: 3, marginTop: 6 },
  subtitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  accountLine: { color: COLORS.dim, fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { color: COLORS.text, fontWeight: '800', fontSize: 15 },
  xpBg: { height: 10, backgroundColor: '#00000066', borderRadius: 5, marginVertical: 8, overflow: 'hidden' },
  xpFill: { height: 10, backgroundColor: COLORS.fire },
  dim: { color: COLORS.dim, fontSize: 12.5 },
  warn: { color: COLORS.bad, fontSize: 12.5, marginTop: 6 },
  grid: { flexDirection: 'row', gap: 10 },
  gridCol: { flex: 1 },
  testNote: { color: COLORS.dim, fontSize: 11.5, textAlign: 'center', marginTop: 10 },
});
