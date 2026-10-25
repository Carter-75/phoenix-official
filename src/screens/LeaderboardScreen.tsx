import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WORLDS } from '../data/catalog';
import { api } from '../services/api';
import { useGame } from '../state/GameContext';
import { COLORS, Panel, ScreenShell } from '../components/ui';

type Tab = 'global' | 'campaign' | 'world' | 'battle';

export function LeaderboardScreen() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('global');
  const [worldId, setWorldId] = useState(1);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError('');
    const load =
      tab === 'global'
        ? api.leaderboard.global()
        : tab === 'campaign'
          ? api.leaderboard.campaign()
          : tab === 'battle'
            ? api.leaderboard.battle()
            : api.leaderboard.world(worldId);
    load
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setError('Leaderboards need the game server. It looks offline right now, your own bests are still saved on this device and in Profile.');
      });
    return () => {
      alive = false;
    };
  }, [tab, worldId]);

  const myName = game.account?.username;

  const renderRow = (r: any, i: number) => {
    const mine = myName && r.username === myName;
    const detail =
      tab === 'global'
        ? `Level ${r.level} - XP ${r.xp}`
        : tab === 'campaign'
          ? `Score ${r.score} - Level ${r.level}`
          : tab === 'battle'
            ? `Rating ${r.rating} - ${r.wins}W / ${r.losses}L`
            : `Score ${r.score}${r.timeSec ? ` - ${r.timeSec}s` : ''}${r.completed ? ' - Cleared' : ''}`;
    return (
      <Panel key={i} style={mine ? styles.mine : undefined}>
        <View style={styles.row}>
          <Text style={styles.rank}>#{r.rank ?? i + 1}</Text>
          <Text style={[styles.name, mine && { color: COLORS.gold }]}>{r.username}</Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      </Panel>
    );
  };

  return (
    <ScreenShell title="Leaderboards" subtitle="Top 100 phoenixes. Sign in and play to get on the board." onBack={() => game.go('menu')}>
      <View style={styles.tabs}>
        {(
          [
            ['global', 'Global'],
            ['campaign', 'Campaign'],
            ['world', 'By World'],
            ['battle', 'Battle'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <TouchableOpacity key={id} style={[styles.tab, tab === id && styles.tabActive]} onPress={() => { game.click(); setTab(id); }}>
            <Text style={styles.tabText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'world' && (
        <View style={styles.tabs}>
          {WORLDS.map((w) => (
            <TouchableOpacity key={w.id} style={[styles.worldTab, worldId === w.id && styles.tabActive]} onPress={() => { game.click(); setWorldId(w.id); }}>
              <Text style={styles.tabText}>{w.id}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : rows === null ? (
        <ActivityIndicator color={COLORS.fire} style={{ marginTop: 24 }} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No scores yet on this board. Be the first.</Text>
      ) : (
        rows.map(renderRow)
      )}
      {!game.account && <Text style={styles.hint}>You are playing as a guest. Sign in from the menu to appear on the leaderboards.</Text>}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  tab: { backgroundColor: COLORS.panel, borderColor: COLORS.panelEdge, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  worldTab: { backgroundColor: COLORS.panel, borderColor: COLORS.panelEdge, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11 },
  tabActive: { borderColor: COLORS.fire, backgroundColor: '#3a1503' },
  tabText: { color: COLORS.text, fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { color: COLORS.gold, fontWeight: '900', width: 38 },
  name: { color: COLORS.text, fontWeight: '800', flex: 1 },
  detail: { color: COLORS.dim, fontSize: 12.5 },
  mine: { borderColor: COLORS.gold },
  error: { color: COLORS.bad, fontSize: 13.5, marginTop: 10, lineHeight: 19 },
  empty: { color: COLORS.dim, fontSize: 14, marginTop: 14 },
  hint: { color: COLORS.dim, fontSize: 12.5, marginTop: 10 },
});
