import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CODEX, TROPHIES } from '../data/catalog';
import { useGame } from '../state/GameContext';
import { COLORS, Panel, ScreenShell } from '../components/ui';

export function CodexScreen() {
  const game = useGame();
  const seen = new Set(game.progress.codexEnemies);
  return (
    <ScreenShell title="Codex" subtitle={`Defeated foes: ${seen.size}/${CODEX.length}. Beat a foe once to record it here.`} onBack={() => game.go('menu')}>
      {CODEX.map((c) => {
        const got = seen.has(c.id);
        return (
          <Panel key={c.id} style={!got ? styles.locked : undefined}>
            <Text style={styles.name}>{got ? c.name : '??? Undiscovered'}</Text>
            <Text style={styles.dim}>{c.kind}</Text>
            {got && <Text style={styles.dim}>{c.blurb}</Text>}
          </Panel>
        );
      })}
    </ScreenShell>
  );
}

export function TrophiesScreen() {
  const game = useGame();
  const earned = new Set(game.progress.trophies);
  return (
    <ScreenShell title="Trophies" subtitle={`Earned ${earned.size}/${TROPHIES.length}`} onBack={() => game.go('menu')}>
      {TROPHIES.map((t) => {
        const got = earned.has(t.id);
        return (
          <Panel key={t.id} style={!got ? styles.locked : styles.earned}>
            <View>
              <Text style={styles.name}>{got ? '★ ' : ''}{t.name}</Text>
              <Text style={styles.dim}>{t.description}</Text>
            </View>
          </Panel>
        );
      })}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  name: { color: COLORS.text, fontWeight: '800', fontSize: 15 },
  dim: { color: COLORS.dim, fontSize: 12.5, marginTop: 2 },
  locked: { opacity: 0.5 },
  earned: { borderColor: COLORS.gold },
});
