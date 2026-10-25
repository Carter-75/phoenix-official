import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MOVES, type MoveType } from '../data/catalog';
import { useGame } from '../state/GameContext';
import { BigButton, COLORS, Panel, ScreenShell } from '../components/ui';

const TABS: Array<{ id: MoveType; label: string; hint: string }> = [
  { id: 'hold', label: 'Hold Moves', hint: 'Press and hold the HOLD button in game' },
  { id: 'double', label: 'Double Moves', hint: 'Double tap or the DOUBLE button in game' },
  { id: 'triple', label: 'Triple Moves', hint: 'Triple tap or the TRIPLE button in game' },
];

export function ShopScreen() {
  const game = useGame();
  const [tab, setTab] = useState<MoveType>('hold');
  const [msg, setMsg] = useState('');
  const moves = useMemo(() => MOVES.filter((m) => m.type === tab), [tab]);
  const equippedId = game.progress.equippedMoves[tab];

  return (
    <ScreenShell title="Move Shop" subtitle="All 75 moves from the original Phoenix. Buy with coins, equip one per slot." onBack={() => game.go('menu')}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.id} style={[styles.tab, tab === t.id && styles.tabActive]} onPress={() => { game.click(); setTab(t.id); setMsg(''); }}>
            <Text style={styles.tabText}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>{TABS.find((t) => t.id === tab)?.hint}</Text>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {moves.map((m) => {
        const owned = game.ownsMove(m.id);
        const equipped = equippedId === m.id;
        return (
          <Panel key={m.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {m.name} {equipped ? '(Equipped)' : owned ? '(Owned)' : ''}
                </Text>
                <Text style={styles.dim}>{m.description}</Text>
                <Text style={styles.dim}>
                  Damage {m.damage} - Cooldown {(m.cooldownMs / 1000).toFixed(m.cooldownMs % 1000 ? 1 : 0)}s{!owned ? ` - Cost ${m.cost} coins` : ''}
                </Text>
              </View>
              {!owned ? (
                <BigButton
                  small
                  label={`Buy ${m.cost}`}
                  onPress={() => {
                    const ok = game.buyMove(m.id);
                    setMsg(ok ? `${m.name} is yours. Equip it any time.` : `Not enough coins for ${m.name}. Clear worlds or grab a coin pack in the Store.`);
                    if (ok) game.click();
                  }}
                />
              ) : !equipped ? (
                <BigButton small label="Equip" color="#2d2154" onPress={() => { game.equipMove(m.id); game.click(); setMsg(`${m.name} equipped.`); }} />
              ) : null}
            </View>
          </Panel>
        );
      })}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  tab: { flex: 1, backgroundColor: COLORS.panel, borderColor: COLORS.panelEdge, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  tabActive: { borderColor: COLORS.fire, backgroundColor: '#3a1503' },
  tabText: { color: COLORS.text, fontWeight: '700', fontSize: 13 },
  hint: { color: COLORS.dim, fontSize: 12.5, marginBottom: 6 },
  msg: { color: COLORS.good, fontSize: 13, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: COLORS.text, fontWeight: '800', fontSize: 15 },
  dim: { color: COLORS.dim, fontSize: 12.5, marginTop: 2 },
});
