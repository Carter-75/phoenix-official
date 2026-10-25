import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useGame } from '../state/GameContext';

export const COLORS = {
  bg: '#0b0620',
  panel: '#17102e',
  panelEdge: '#2d2154',
  text: '#ffffff',
  dim: '#b3a8d9',
  fire: '#ff6a00',
  gold: '#ffb347',
  good: '#39d98a',
  bad: '#ff5252',
  blue: '#44aaff',
};

export function ScreenShell({
  title,
  subtitle,
  onBack,
  children,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { progress, account } = useGame();
  const body = (
    <View style={styles.content}>
      <View style={styles.headerRow}>
        {onBack ? (
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backText}>{"< Back"}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 70 }} />
        )}
        <View style={styles.wallet}>
          <Text style={styles.walletText}>Coins {progress.coins}</Text>
          <Text style={[styles.walletText, { color: COLORS.blue }]}>Gems {progress.gems}</Text>
          <Text style={styles.walletText}>Lv {progress.level}</Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {account ? <Text style={styles.accountLine}>Signed in as {account.username}</Text> : <Text style={styles.accountLine}>Playing as guest</Text>}
      {children}
    </View>
  );
  return (
    <View style={styles.root}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

export function BigButton({
  label,
  onPress,
  color = COLORS.fire,
  disabled,
  small,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.bigBtn, { backgroundColor: disabled ? '#3a3355' : color }, small && styles.bigBtnSmall]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={[styles.bigBtnText, small && { fontSize: 14 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scrollPad: { paddingBottom: 40 },
  content: { flex: 1, paddingHorizontal: 18, paddingTop: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  backBtn: { paddingVertical: 6, paddingRight: 10 },
  backText: { color: COLORS.gold, fontSize: 15, fontWeight: '700' },
  wallet: { flexDirection: 'row', gap: 12 },
  walletText: { color: COLORS.gold, fontSize: 13, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: COLORS.dim, fontSize: 14, marginTop: 2 },
  accountLine: { color: COLORS.dim, fontSize: 12, marginTop: 4, marginBottom: 10 },
  bigBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', marginVertical: 5 },
  bigBtnSmall: { paddingVertical: 9, paddingHorizontal: 12 },
  bigBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  panel: { backgroundColor: COLORS.panel, borderColor: COLORS.panelEdge, borderWidth: 1, borderRadius: 14, padding: 14, marginVertical: 6 },
});
