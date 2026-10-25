import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GameScreen } from './game/GameScreen';
import { MonetizationProvider } from './services/monetization';
import { GameProvider, useGame } from './state/GameContext';
import { AuthScreen } from './screens/AuthScreen';
import { CodexScreen, TrophiesScreen } from './screens/CodexScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { MenuScreen } from './screens/MenuScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ShopScreen } from './screens/ShopScreen';
import { SkinsScreen } from './screens/SkinsScreen';
import { StoreScreen } from './screens/StoreScreen';
import { WorldSelectScreen } from './screens/WorldSelectScreen';

function Router() {
  const game = useGame();
  if (!game.loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#ff6a00" size="large" />
      </View>
    );
  }
  switch (game.screen) {
    case 'menu':
      return <MenuScreen />;
    case 'worlds':
      return <WorldSelectScreen />;
    case 'game':
      return <GameScreen key={`campaign-${game.selectedWorld}`} mode="campaign" worldId={game.selectedWorld} />;
    case 'battle':
      return <GameScreen key="battle" mode="battle" worldId={1} />;
    case 'shop':
      return <ShopScreen />;
    case 'skins':
      return <SkinsScreen />;
    case 'store':
      return <StoreScreen />;
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'auth':
      return <AuthScreen />;
    case 'codex':
      return <CodexScreen />;
    case 'trophies':
      return <TrophiesScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <MenuScreen />;
  }
}

export default function Root() {
  return (
    <GameProvider>
      <MonetizationProvider>
        <View style={styles.root}>
          <Router />
        </View>
      </MonetizationProvider>
    </GameProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0620' },
  loading: { flex: 1, backgroundColor: '#0b0620', alignItems: 'center', justifyContent: 'center' },
});
