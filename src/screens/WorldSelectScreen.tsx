import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WORLDS } from '../data/catalog';
import { useGame } from '../state/GameContext';
import { COLORS, Panel, ScreenShell } from '../components/ui';

export function WorldSelectScreen() {
  const game = useGame();
  const p = game.progress;
  return (
    <ScreenShell title="World Select" subtitle="Clear the waves, beat the boss, unlock the next world." onBack={() => game.go('menu')}>
      {WORLDS.map((w) => {
        const unlocked = p.unlockedWorlds.includes(w.id);
        const best = p.worldBests.find((x) => x.worldId === w.id);
        return (
          <TouchableOpacity key={w.id} disabled={!unlocked} onPress={() => { game.click(); game.playWorld(w.id); }}>
            <Panel style={[styles.card, { borderColor: unlocked ? w.color : COLORS.panelEdge, opacity: unlocked ? 1 : 0.55 }]}>
              <View style={styles.row}>
                <View style={[styles.badge, { backgroundColor: w.color }]}>
                  <Text style={styles.badgeText}>{w.id}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {w.name} {best?.completed ? '- CLEARED' : unlocked ? '' : '- LOCKED'}
                  </Text>
                  <Text style={styles.dim}>
                    Boss: {w.boss} - Theme: {w.theme}
                  </Text>
                  <Text style={styles.dim}>{w.description}</Text>
                  {best && best.bestScore > 0 && (
                    <Text style={styles.best}>
                      Best score {best.bestScore}
                      {best.bestTime ? ` - Best time ${best.bestTime}s` : ''}
                    </Text>
                  )}
                </View>
                {unlocked && <Text style={styles.play}>PLAY</Text>}
              </View>
            </Panel>
          </TouchableOpacity>
        );
      })}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  badge: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#0b0620', fontWeight: '900', fontSize: 18 },
  name: { color: COLORS.text, fontWeight: '800', fontSize: 16 },
  dim: { color: COLORS.dim, fontSize: 12.5, marginTop: 2 },
  best: { color: COLORS.gold, fontSize: 12.5, marginTop: 3, fontWeight: '700' },
  play: { color: COLORS.fire, fontWeight: '900', fontSize: 14 },
});
