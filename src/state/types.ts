export interface WorldBest {
  worldId: number;
  bestScore: number;
  bestTime: number;
  completed: boolean;
}

export interface Settings {
  soundEnabled: boolean;
  musicEnabled: boolean;
  hapticsEnabled: boolean;
}

export interface PlayerProgress {
  level: number;
  xp: number;
  xpToNext: number;
  coins: number;
  gems: number;
  deathCount: number;
  ownedMoves: string[];
  equippedMoves: { hold: string; double: string; triple: string };
  unlockedWorlds: number[];
  worldBests: WorldBest[];
  battleWins: number;
  battleLosses: number;
  battleRating: number;
  battleBestScore: number;
  trophies: string[];
  codexEnemies: string[];
  ownedSkins: string[];
  activeSkin: string;
  removeAds: boolean;
  movePackAll: boolean;
  skinPackAll: boolean;
  phoenixPassUntil: number;
  boostUntil: number; // local rewarded 2x boost expiry (ms epoch)
  settings: Settings;
  acceptedLegalPolicies: boolean;
}

export interface AccountUser {
  id: string;
  email: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  username: string;
}

export const STARTER_MOVES = ['hold_1', 'double_1', 'triple_1'];

export function defaultProgress(): PlayerProgress {
  return {
    level: 1,
    xp: 0,
    xpToNext: 100,
    coins: 50,
    gems: 0,
    deathCount: 0,
    ownedMoves: [...STARTER_MOVES],
    equippedMoves: { hold: 'hold_1', double: 'double_1', triple: 'triple_1' },
    unlockedWorlds: [1],
    worldBests: [],
    battleWins: 0,
    battleLosses: 0,
    battleRating: 0,
    battleBestScore: 0,
    trophies: [],
    codexEnemies: [],
    ownedSkins: ['ember'],
    activeSkin: 'ember',
    removeAds: false,
    movePackAll: false,
    skinPackAll: false,
    phoenixPassUntil: 0,
    boostUntil: 0,
    settings: { soundEnabled: true, musicEnabled: true, hapticsEnabled: true },
    acceptedLegalPolicies: false,
  };
}

export function campaignScore(p: PlayerProgress): number {
  return p.worldBests.reduce((sum, w) => sum + (w.bestScore || 0), 0);
}

export function hasActiveBoost(p: PlayerProgress): boolean {
  return p.boostUntil > Date.now() || p.phoenixPassUntil > Date.now();
}
