import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SKINS } from '../data/catalog';
import { PhoenixSprite } from '../game/PhoenixSprite';
import { useGame } from '../state/GameContext';
import { BigButton, COLORS, Panel, ScreenShell } from '../components/ui';

export function SkinsScreen() {
  const game = useGame();
  const [msg, setMsg] = useState('');
  const p = game.progress;
  return (
    <ScreenShell title="Phoenix Skins" subtitle="Fire, Frost, and Eclipse come from Phoenix-Fall's three phoenixes." onBack={() => game.go('menu')}>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {SKINS.map((s) => {
        const owned = p.ownedSkins.includes(s.id) || p.skinPackAll;
        const active = p.activeSkin === s.id;
        return (
          <Panel key={s.id}>
            <View style={styles.row}>
              <PhoenixSprite skin={s} size={54} flap={0.4} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.name}>
                  {s.name} {active ? '(Active)' : owned ? '(Owned)' : ''}
                </Text>
                <Text style={styles.dim}>
                  {s.passOnly ? 'Phoenix Pass exclusive' : s.gemCost === 0 ? 'Default skin' : `${s.gemCost} gems`}
                </Text>
              </View>
              {!owned && !s.passOnly && (
                <BigButton
                  small
                  label={`Buy ${s.gemCost} gems`}
                  onPress={() => {
                    const ok = game.buySkin(s.id);
                    setMsg(ok ? `${s.name} unlocked and equipped.` : `Not enough gems for ${s.name}. Gems are in the Store.`);
                    if (ok) game.click();
                  }}
                />
              )}
              {owned && !active && <BigButton small label="Equip" color="#2d2154" onPress={() => { game.setSkin(s.id); game.click(); }} />}
            </View>
          </Panel>
        );
      })}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { color: COLORS.text, fontWeight: '800', fontSize: 15 },
  dim: { color: COLORS.dim, fontSize: 12.5, marginTop: 2 },
  msg: { color: COLORS.good, fontSize: 13, marginBottom: 6 },
});
