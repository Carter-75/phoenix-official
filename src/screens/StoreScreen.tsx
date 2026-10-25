import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PRODUCTS } from '../config/monetization.config';
import { useMonetization } from '../services/monetization';
import { useGame } from '../state/GameContext';
import { BigButton, COLORS, Panel, ScreenShell } from '../components/ui';

// In-app purchases. On the Play Store these run through Google Play Billing
// (expo-iap). In test mode (web preview, dev builds before Play products
// exist) purchases are simulated and grant immediately. No real charge is
// possible in test mode.
export function StoreScreen() {
  const game = useGame();
  const monetization = useMonetization();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const p = game.progress;

  const ownedNonConsumable = (id: string) =>
    (id === 'remove_ads' && p.removeAds) ||
    (id === 'move_pack_all' && p.movePackAll) ||
    (id === 'skin_pack_all' && p.skinPackAll) ||
    (id === 'phoenix_pass' && p.phoenixPassUntil > Date.now());

  const buy = async (id: string, name: string) => {
    setBusy(id);
    const ok = await monetization.purchase(id);
    setBusy('');
    setMsg(ok ? `${name} added to your account.` : `Purchase of ${name} did not go through. Nothing was charged.`);
    if (ok) game.click();
  };

  return (
    <ScreenShell title="Store" subtitle="Coins, gems, packs, Remove Ads, and the Phoenix Pass." onBack={() => game.go('menu')}>
      {monetization.testMode && (
        <Text style={styles.testNote}>TEST MODE: purchases are simulated here and grant instantly. Real billing turns on when the products exist in Play Console and the config flag flips.</Text>
      )}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {PRODUCTS.map((prod) => {
        const owned = prod.kind !== 'consumable' && ownedNonConsumable(prod.id);
        return (
          <Panel key={prod.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {prod.name} {owned ? '(Owned)' : ''}
                </Text>
                <Text style={styles.dim}>{prod.description}</Text>
                <Text style={styles.dim}>{prod.kind === 'subscription' ? 'Subscription, renews monthly, cancel any time in Google Play' : prod.kind === 'non-consumable' ? 'One-time purchase, yours forever' : 'Consumable'}</Text>
              </View>
              {!owned && (
                <BigButton small label={busy === prod.id ? 'Working...' : prod.priceLabel} disabled={busy !== ''} onPress={() => buy(prod.id, prod.name)} />
              )}
            </View>
          </Panel>
        );
      })}
      <BigButton label="Restore Purchases" color="#2d2154" onPress={async () => { await monetization.restorePurchases(); setMsg('Purchases restored. Owned packs are active again.'); }} />
      {!p.removeAds && <Text style={styles.dimNote}>Remove Ads kills the in-between ads for good. The optional rewarded ads (revive, 2x boost) always stay available.</Text>}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: COLORS.text, fontWeight: '800', fontSize: 15 },
  dim: { color: COLORS.dim, fontSize: 12.5, marginTop: 2 },
  testNote: { color: COLORS.gold, fontSize: 12.5, marginBottom: 8 },
  msg: { color: COLORS.good, fontSize: 13, marginBottom: 6 },
  dimNote: { color: COLORS.dim, fontSize: 12.5, marginTop: 8 },
});
