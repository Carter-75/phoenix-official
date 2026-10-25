import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_CONFIG } from '../config/app.config';
import type { PlayerProgress } from '../state/types';

const TOKEN_KEY = 'phoenix.authToken';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${APP_CONFIG.apiUrl}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, 'Cannot reach the game server. Check your connection.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (json as any).message || (json as any).error || `Request failed (${res.status})`, (json as any).code);
  }
  return json as T;
}

export const tokenStore = {
  get: () => AsyncStorage.getItem(TOKEN_KEY),
  set: (t: string) => AsyncStorage.setItem(TOKEN_KEY, t),
  clear: () => AsyncStorage.removeItem(TOKEN_KEY),
};

export interface AuthResponse {
  user: any;
  token: string;
}

export const api = {
  health: () => request<{ ok: boolean; db: string }>('/health', { auth: false }),

  usernameAvailable: (username: string) =>
    request<{ available: boolean; reason: string | null }>(`/auth/username-available?username=${encodeURIComponent(username)}`, { auth: false }),

  register: (email: string, password: string, username: string, acceptedLegalPolicies: boolean) =>
    request<AuthResponse>('/auth/register', { method: 'POST', auth: false, body: { email, password, username, acceptedLegalPolicies } }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', auth: false, body: { email, password } }),

  google: (idToken: string) =>
    request<{ user?: any; token?: string; needsUsername?: boolean; pendingToken?: string; email?: string | null }>('/auth/google', {
      method: 'POST',
      auth: false,
      body: { idToken },
    }),

  googleComplete: (pendingToken: string, username: string, acceptedLegalPolicies: boolean) =>
    request<AuthResponse>('/auth/google/complete', { method: 'POST', auth: false, body: { pendingToken, username, acceptedLegalPolicies } }),

  linkGoogle: (idToken: string) => request<{ user: any }>('/auth/link/google', { method: 'POST', body: { idToken } }),

  setPassword: (password: string, currentPassword?: string) =>
    request<{ user: any }>('/auth/set-password', { method: 'POST', body: { password, currentPassword } }),

  me: () => request<{ user: any }>('/auth/me'),

  acceptPolicies: () => request<{ user: any }>('/auth/accept-policies', { method: 'POST', body: {} }),

  deleteAccount: () => request<{ message: string }>('/auth/me', { method: 'DELETE' }),

  sync: (p: PlayerProgress) =>
    request<{ user: any }>('/game/sync', {
      method: 'POST',
      body: {
        level: p.level,
        xp: p.xp,
        xpToNext: p.xpToNext,
        coins: p.coins,
        gems: p.gems,
        deathCount: p.deathCount,
        ownedMoves: p.ownedMoves,
        equippedMoves: p.equippedMoves,
        unlockedWorlds: p.unlockedWorlds,
        worldBests: p.worldBests,
        trophies: p.trophies,
        codexEnemies: p.codexEnemies,
        ownedSkins: p.ownedSkins,
        activeSkin: p.activeSkin,
        removeAds: p.removeAds,
        movePackAll: p.movePackAll,
        skinPackAll: p.skinPackAll,
        phoenixPassUntil: p.phoenixPassUntil,
        settings: p.settings,
      },
    }),

  submitWorldScore: (worldId: number, score: number, timeSec: number, completed: boolean) =>
    request<{ isBest: boolean; campaignScore: number }>('/game/score/world', { method: 'POST', body: { worldId, score, timeSec, completed } }),

  submitBattle: (won: boolean, score: number) =>
    request<{ battleRating: number; battleWins: number; battleLosses: number }>('/game/score/battle', { method: 'POST', body: { won, score } }),

  leaderboard: {
    global: () => request<any[]>('/leaderboard/global', { auth: false }),
    campaign: () => request<any[]>('/leaderboard/campaign', { auth: false }),
    world: (worldId: number) => request<any[]>(`/leaderboard/world/${worldId}`, { auth: false }),
    battle: () => request<any[]>('/leaderboard/battle', { auth: false }),
  },
};

// Map a server user record into local progress fields the client owns.
export function progressFromServer(user: any): Partial<PlayerProgress> {
  if (!user) return {};
  return {
    level: user.level ?? 1,
    xp: user.xp ?? 0,
    xpToNext: user.xpToNext ?? 100,
    coins: user.coins ?? 0,
    gems: user.gems ?? 0,
    deathCount: user.deathCount ?? 0,
    ownedMoves: Array.isArray(user.ownedMoves) && user.ownedMoves.length ? user.ownedMoves : undefined,
    equippedMoves: user.equippedMoves ?? undefined,
    unlockedWorlds: Array.isArray(user.unlockedWorlds) && user.unlockedWorlds.length ? user.unlockedWorlds : undefined,
    worldBests: Array.isArray(user.worldBests) ? user.worldBests : undefined,
    battleWins: user.battleWins ?? 0,
    battleLosses: user.battleLosses ?? 0,
    battleRating: user.battleRating ?? 0,
    battleBestScore: user.battleBestScore ?? 0,
    trophies: user.trophies ?? [],
    codexEnemies: user.codexEnemies ?? [],
    ownedSkins: Array.isArray(user.ownedSkins) && user.ownedSkins.length ? user.ownedSkins : undefined,
    activeSkin: user.activeSkin ?? 'ember',
    removeAds: !!user.removeAds,
    movePackAll: !!user.movePackAll,
    skinPackAll: !!user.skinPackAll,
    phoenixPassUntil: user.phoenixPassUntil ?? 0,
    settings: user.settings ?? undefined,
    acceptedLegalPolicies: !!user.acceptedLegalPolicies,
  };
}

export function accountFromServer(user: any): { id: string; email: string | null; hasPassword: boolean; hasGoogle: boolean; username: string } {
  return {
    id: user.id,
    email: user.email ?? null,
    hasPassword: !!user.hasPassword,
    hasGoogle: !!user.hasGoogle,
    username: user.username,
  };
}
