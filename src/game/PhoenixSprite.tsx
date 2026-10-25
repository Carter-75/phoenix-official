import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Skin } from '../data/catalog';

// The phoenix is drawn from layered shapes: a glowing body, two swept wings
// that flap with `flap` (0..1), and a 3-feather tail. Colors come from the skin.
export function PhoenixSprite({ skin, size = 56, flap = 0, hurt = false }: { skin: Skin; size?: number; flap?: number; hurt?: boolean }) {
  const wingLift = -8 - flap * 10;
  return (
    <View style={[styles.root, { width: size, height: size }]} pointerEvents="none">
      {/* tail feathers */}
      <View style={[styles.tail, { left: size * 0.32, top: size * 0.72, backgroundColor: skin.accent, transform: [{ rotate: '-14deg' }] }]} />
      <View style={[styles.tail, { left: size * 0.47, top: size * 0.76, backgroundColor: skin.primary, transform: [{ rotate: '0deg' }] }]} />
      <View style={[styles.tail, { left: size * 0.62, top: size * 0.72, backgroundColor: skin.accent, transform: [{ rotate: '14deg' }] }]} />
      {/* wings */}
      <View
        style={[
          styles.wing,
          {
            left: -size * 0.42,
            top: size * 0.2 + wingLift,
            backgroundColor: skin.primary,
            transform: [{ rotate: `${-28 - flap * 18}deg` }],
          },
        ]}
      />
      <View
        style={[
          styles.wing,
          {
            right: -size * 0.42,
            top: size * 0.2 + wingLift,
            backgroundColor: skin.primary,
            transform: [{ rotate: `${28 + flap * 18}deg` }],
          },
        ]}
      />
      {/* body */}
      <View
        style={[
          styles.body,
          {
            width: size * 0.52,
            height: size * 0.66,
            left: size * 0.24,
            top: size * 0.18,
            backgroundColor: hurt ? '#ff2222' : skin.secondary,
            shadowColor: skin.primary,
          },
        ]}
      />
      {/* head */}
      <View style={[styles.head, { width: size * 0.3, height: size * 0.3, left: size * 0.35, top: size * 0.02, backgroundColor: skin.primary }]} />
      {/* crest */}
      <View style={[styles.crest, { left: size * 0.46, top: -size * 0.08, backgroundColor: skin.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  body: { position: 'absolute', borderRadius: 999, shadowOpacity: 0.9, shadowRadius: 14, elevation: 8 },
  head: { position: 'absolute', borderRadius: 999 },
  crest: { position: 'absolute', width: 5, height: 14, borderRadius: 3 },
  wing: { position: 'absolute', width: 34, height: 13, borderRadius: 8 },
  tail: { position: 'absolute', width: 7, height: 20, borderRadius: 4 },
});
