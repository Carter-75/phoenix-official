import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { MOVE_BY_ID, MOVES, SKINS, xpForLevel } from '../data/catalog';
import { api, accountFromServer, progressFromServer, tokenStore } from '../services/api';
import { audio } from '../services/audio';
import { defaultProgress, hasActiveBoost, type AccountUser, type PlayerProgress } from './types';

const PROGRESS_KEY = 'phoenix.progress.v1';
const ACCOUNT_KEY = 'phoenix.account.v1';

export type Screen =
  | 'menu'
  | 'worlds'
  | 'game'
  | 'battle'
  | 'shop'
  | 'skins'
  | 'store'
  | 'leaderboard'
  | 'profile'
  | 'auth'
  | 'codex'
  | 'trophies'
  | 'settings';

interface GameContextValue {
  progress: PlayerProgress;
  account: AccountUser | null;
  screen: Screen;
  selectedWorld: number;
  loaded: boolean;
  serverOnline: boolean | null;
  go: (s: Screen) => void;
  playWorld: (worldId: number) => void;
  addCoins: (n: number) => void;
  addGems: (n: number) => void;
  spendCoins: (n: number) => boolean;
  spendGems: (n: number) => boolean;
  gainXp: (n: number) => { leveledUp: boolean };
  buyMove: (moveId: string) => boolean;
  equipMove: (moveId: string) => void;
  ownsMove: (moveId: string) => boolean;
  buySkin: (skinId: string) => boolean;
  setSkin: (skinId: string) => void;
  recordWorldRun: (worldId: number, score: number, timeSec: number, completed: boolean) => void;
  recordBattle: (won: boolean, score: number) => void;
  recordDeath: () => void;
  addCodex: (id: string) => void;
  activateBoost: () => void;
  applyEntitlement: (patch: Partial<PlayerProgress>) => void;
  updateSettings: (s: Partial<PlayerProgress['settings']>) => void;
  setAcceptedPolicies: (v: boolean) => void;
  signInWithSession: (user: any, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccount: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  resetAllProgress: () => Promise<void>;
  syncNow: () => Promise<void>;
  haptic: () => void;
  click: () => void;
}

const Ctx = createContext<GameContextValue | null>(null);

function checkTrophies(p: PlayerProgress): PlayerProgress {
  const t = new Set(p.trophies);
  const add = (id: string, cond: boolean) => {
    if (cond) t.add(id);
  };
  add('first_boss', p.worldBests.some((w) => w.completed));
  add('world_5', p.worldBests.some((w) => w.worldId === 5 && w.completed));
  add('world_10', p.worldBests.some((w) => w.worldId === 10 && w.completed));
  add('level_10', p.level >= 10);
  add('level_25', p.level >= 25);
  add('collector_10', p.ownedMoves.length >= 10);
  add('collector_all', p.ownedMoves.length >= MOVES.length);
  add('battle_1', p.battleWins >= 1);
  add('battle_25', p.battleWins >= 25);
  add('rich_1000', p.coins >= 1000);
  add('gem_hoarder', p.gems >= 10);
  return { ...p, trophies: Array.from(t) };
}

// Merge cloud progress into local on sign-in: keep the better score fields,
// union collections, and take max currencies so no device loses progress.
function mergeProgress(local: PlayerProgress, cloud: Partial<PlayerProgress>): PlayerProgress {
  const merged: PlayerProgress = { ...local };
  if (cloud.level !== undefined && cloud.level > local.level) {
    merged.level = cloud.level;
    merged.xp = cloud.xp ?? local.xp;
    merged.xpToNext = cloud.xpToNext ?? local.xpToNext;
  }
  merged.coins = Math.max(local.coins, cloud.coins ?? 0);
  merged.gems = Math.max(local.gems, cloud.gems ?? 0);
  merged.deathCount = Math.max(local.deathCount, cloud.deathCount ?? 0);
  if (cloud.ownedMoves) merged.ownedMoves = Array.from(new Set([...local.ownedMoves, ...cloud.ownedMoves]));
  if (cloud.equippedMoves) merged.equippedMoves = cloud.equippedMoves;
  if (cloud.unlockedWorlds) merged.unlockedWorlds = Array.from(new Set([...local.unlockedWorlds, ...cloud.unlockedWorlds])).sort((a, b) => a - b);
  if (cloud.worldBests) {
    const byId = new Map(local.worldBests.map((w) => [w.worldId, { ...w }]));
    for (const wb of cloud.worldBests) {
      const cur = byId.get(wb.worldId);
      if (!cur) byId.set(wb.worldId, { ...wb });
      else {
        cur.bestScore = Math.max(cur.bestScore, wb.bestScore);
        cur.bestTime = cur.bestTime === 0 ? wb.bestTime : wb.bestTime === 0 ? cur.bestTime : Math.min(cur.bestTime, wb.bestTime);
        cur.completed = cur.completed || wb.completed;
      }
    }
    merged.worldBests = Array.from(byId.values());
  }
  merged.battleWins = Math.max(local.battleWins, cloud.battleWins ?? 0);
  merged.battleLosses = Math.max(local.battleLosses, cloud.battleLosses ?? 0);
  merged.battleRating = Math.max(local.battleRating, cloud.battleRating ?? 0);
  merged.battleBestScore = Math.max(local.battleBestScore, cloud.battleBestScore ?? 0);
  merged.trophies = Array.from(new Set([...local.trophies, ...(cloud.trophies ?? [])]));
  merged.codexEnemies = Array.from(new Set([...local.codexEnemies, ...(cloud.codexEnemies ?? [])]));
  if (cloud.ownedSkins) merged.ownedSkins = Array.from(new Set([...local.ownedSkins, ...cloud.ownedSkins]));
  if (cloud.activeSkin && merged.ownedSkins.includes(cloud.activeSkin)) merged.activeSkin = cloud.activeSkin;
  merged.removeAds = local.removeAds || !!cloud.removeAds;
  merged.movePackAll = local.movePackAll || !!cloud.movePackAll;
  merged.skinPackAll = local.skinPackAll || !!cloud.skinPackAll;
  merged.phoenixPassUntil = Math.max(local.phoenixPassUntil, cloud.phoenixPassUntil ?? 0);
  merged.acceptedLegalPolicies = local.acceptedLegalPolicies || !!cloud.acceptedLegalPolicies;
  return merged;
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgressState] = useState<PlayerProgress>(defaultProgress());
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [screen, setScreen] = useState<Screen>('menu');
  const [selectedWorld, setSelectedWorld] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const accountRef = useRef(account);
  accountRef.current = account;

  const setProgress = useCallback((updater: (p: PlayerProgress) => PlayerProgress) => {
    setProgressState((prev) => {
      const next = checkTrophies(updater(prev));
      AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const syncNow = useCallback(async () => {
    if (!accountRef.current) return;
    try {
      const { user } = await api.sync(progressRef.current);
      setServerOnline(true);
      // Server is authoritative for rating fields it computes.
      setProgressState((prev) => {
        const next = {
          ...prev,
          battleRating: user.battleRating ?? prev.battleRating,
          battleWins: Math.max(prev.battleWins, user.battleWins ?? 0),
          battleLosses: Math.max(prev.battleLosses, user.battleLosses ?? 0),
        };
        AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    } catch (e) {
      setServerOnline(false);
    }
  }, []);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncNow().catch(() => {});
    }, 1200);
  }, [syncNow]);

  // Load local state, then restore the session if a token exists.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PROGRESS_KEY);
        if (raw) setProgressState({ ...defaultProgress(), ...JSON.parse(raw) });
        const accRaw = await AsyncStorage.getItem(ACCOUNT_KEY);
        if (accRaw) setAccount(JSON.parse(accRaw));
        const token = await tokenStore.get();
        if (token) {
          try {
            const { user } = await api.me();
            const acct = accountFromServer(user);
            setAccount(acct);
            await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(acct));
            setProgress((p) => mergeProgress(p, progressFromServer(user)));
            setServerOnline(true);
          } catch (e) {
            setServerOnline(false);
          }
        } else {
          api
            .health()
            .then(() => setServerOnline(true))
            .catch(() => setServerOnline(false));
        }
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    audio.init().then(() => audio.setEnabled(progress.settings.soundEnabled, progress.settings.musicEnabled));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const go = useCallback((s: Screen) => setScreen(s), []);

  const playWorld = useCallback((worldId: number) => {
    setSelectedWorld(worldId);
    setScreen('game');
  }, []);

  const addCoins = useCallback((n: number) => setProgress((p) => ({ ...p, coins: p.coins + Math.max(0, Math.floor(n)) })), [setProgress]);
  const addGems = useCallback((n: number) => setProgress((p) => ({ ...p, gems: p.gems + Math.max(0, Math.floor(n)) })), [setProgress]);

  const spendCoins = useCallback(
    (n: number) => {
      if (progressRef.current.coins < n) return false;
      setProgress((p) => ({ ...p, coins: p.coins - n }));
      scheduleSync();
      return true;
    },
    [setProgress, scheduleSync]
  );

  const spendGems = useCallback(
    (n: number) => {
      if (progressRef.current.gems < n) return false;
      setProgress((p) => ({ ...p, gems: p.gems - n }));
      scheduleSync();
      return true;
    },
    [setProgress, scheduleSync]
  );

  const gainXp = useCallback(
    (n: number) => {
      let leveledUp = false;
      setProgress((p) => {
        let { xp, level, xpToNext } = p;
        xp += Math.max(0, Math.floor(n));
        while (xp >= xpToNext) {
          xp -= xpToNext;
          level += 1;
          xpToNext = xpForLevel(level);
          leveledUp = true;
        }
        return { ...p, xp, level, xpToNext };
      });
      if (leveledUp) audio.play('levelup');
      scheduleSync();
      return { leveledUp };
    },
    [setProgress, scheduleSync]
  );

  const ownsMove = useCallback(
    (moveId: string) => progressRef.current.movePackAll || progressRef.current.ownedMoves.includes(moveId),
    []
  );

  const buyMove = useCallback(
    (moveId: string) => {
      const move = MOVE_BY_ID[moveId];
      if (!move || ownsMove(moveId)) return false;
      if (!spendCoins(move.cost)) return false;
      setProgress((p) => ({ ...p, ownedMoves: Array.from(new Set([...p.ownedMoves, moveId])) }));
      scheduleSync();
      return true;
    },
    [ownsMove, spendCoins, setProgress, scheduleSync]
  );

  const equipMove = useCallback(
    (moveId: string) => {
      const move = MOVE_BY_ID[moveId];
      if (!move || !ownsMove(moveId)) return;
      setProgress((p) => ({ ...p, equippedMoves: { ...p.equippedMoves, [move.type]: moveId } }));
      scheduleSync();
    },
    [ownsMove, setProgress, scheduleSync]
  );

  const buySkin = useCallback(
    (skinId: string) => {
      const skin = SKINS.find((s) => s.id === skinId);
      if (!skin || progressRef.current.ownedSkins.includes(skinId) || progressRef.current.skinPackAll) return false;
      if (skin.passOnly) return false;
      if (!spendGems(skin.gemCost)) return false;
      setProgress((p) => ({ ...p, ownedSkins: Array.from(new Set([...p.ownedSkins, skinId])), activeSkin: skinId }));
      scheduleSync();
      return true;
    },
    [spendGems, setProgress, scheduleSync]
  );

  const setSkin = useCallback(
    (skinId: string) => {
      if (!progressRef.current.ownedSkins.includes(skinId) && !progressRef.current.skinPackAll) return;
      setProgress((p) => ({ ...p, activeSkin: skinId }));
      scheduleSync();
    },
    [setProgress, scheduleSync]
  );

  const recordWorldRun = useCallback(
    (worldId: number, score: number, timeSec: number, completed: boolean) => {
      setProgress((p) => {
        const existing = p.worldBests.find((w) => w.worldId === worldId);
        const entry = {
          worldId,
          bestScore: Math.max(existing?.bestScore ?? 0, score),
          bestTime: timeSec > 0 ? (existing?.bestTime ? Math.min(existing.bestTime, timeSec) : timeSec) : existing?.bestTime ?? 0,
          completed: (existing?.completed ?? false) || completed,
        };
        const worldBests = [...p.worldBests.filter((w) => w.worldId !== worldId), entry].sort((a, b) => a.worldId - b.worldId);
        const unlockedWorlds = completed && worldId < 10 ? Array.from(new Set([...p.unlockedWorlds, worldId + 1])) : p.unlockedWorlds;
        return { ...p, worldBests, unlockedWorlds };
      });
      if (accountRef.current) {
        api
          .submitWorldScore(worldId, score, timeSec, completed)
          .then(() => setServerOnline(true))
          .catch(() => {
            setServerOnline(false);
            scheduleSync();
          });
      }
    },
    [setProgress, scheduleSync]
  );

  const recordBattle = useCallback(
    (won: boolean, score: number) => {
      setProgress((p) => ({
        ...p,
        battleWins: p.battleWins + (won ? 1 : 0),
        battleLosses: p.battleLosses + (won ? 0 : 1),
        battleRating: Math.max(0, p.battleRating + (won ? 25 : -15)),
        battleBestScore: Math.max(p.battleBestScore, score),
      }));
      if (accountRef.current) {
        api
          .submitBattle(won, score)
          .then((r) => {
            setServerOnline(true);
            setProgress((p) => ({ ...p, battleRating: r.battleRating, battleWins: r.battleWins, battleLosses: r.battleLosses }));
          })
          .catch(() => setServerOnline(false));
      }
    },
    [setProgress]
  );

  const recordDeath = useCallback(() => {
    setProgress((p) => ({ ...p, deathCount: p.deathCount + 1 }));
    scheduleSync();
  }, [setProgress, scheduleSync]);

  const addCodex = useCallback(
    (id: string) => {
      setProgress((p) => (p.codexEnemies.includes(id) ? p : { ...p, codexEnemies: [...p.codexEnemies, id] }));
    },
    [setProgress]
  );

  const activateBoost = useCallback(() => {
    setProgress((p) => ({ ...p, boostUntil: Date.now() + 5 * 60_000 }));
  }, [setProgress]);

  const applyEntitlement = useCallback(
    (patch: Partial<PlayerProgress>) => {
      setProgress((p) => {
        const next = { ...p, ...patch };
        if (patch.movePackAll) next.ownedMoves = MOVES.map((m) => m.id);
        if (patch.skinPackAll) next.ownedSkins = SKINS.map((s) => s.id);
        if (patch.phoenixPassUntil && patch.phoenixPassUntil > Date.now()) {
          next.ownedSkins = Array.from(new Set([...next.ownedSkins, 'celestial']));
        }
        return next;
      });
      scheduleSync();
    },
    [setProgress, scheduleSync]
  );

  const updateSettings = useCallback(
    (s: Partial<PlayerProgress['settings']>) => {
      setProgress((p) => ({ ...p, settings: { ...p.settings, ...s } }));
      const merged = { ...progressRef.current.settings, ...s };
      audio.setEnabled(merged.soundEnabled, merged.musicEnabled);
      scheduleSync();
    },
    [setProgress, scheduleSync]
  );

  const setAcceptedPolicies = useCallback(
    (v: boolean) => {
      setProgress((p) => ({ ...p, acceptedLegalPolicies: v }));
      if (v && accountRef.current) api.acceptPolicies().catch(() => {});
    },
    [setProgress]
  );

  const signInWithSession = useCallback(
    async (user: any, token: string) => {
      await tokenStore.set(token);
      const acct = accountFromServer(user);
      setAccount(acct);
      await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(acct));
      setProgress((p) => mergeProgress(p, progressFromServer(user)));
      setServerOnline(true);
      // Push the merged result up so the account holds everything.
      setTimeout(() => {
        syncNow().catch(() => {});
      }, 300);
    },
    [setProgress, syncNow]
  );

  const signOut = useCallback(async () => {
    await tokenStore.clear();
    setAccount(null);
    await AsyncStorage.removeItem(ACCOUNT_KEY);
  }, []);

  const refreshAccount = useCallback(async () => {
    const { user } = await api.me();
    const acct = accountFromServer(user);
    setAccount(acct);
    await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(acct));
    setProgress((p) => mergeProgress(p, progressFromServer(user)));
  }, [setProgress]);

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount();
    await signOut();
    const fresh = defaultProgress();
    setProgressState(fresh);
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(fresh));
  }, [signOut]);

  const resetAllProgress = useCallback(async () => {
    const fresh = defaultProgress();
    setProgressState(fresh);
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(fresh));
    scheduleSync();
  }, [scheduleSync]);

  const haptic = useCallback(() => {
    if (progressRef.current.settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const click = useCallback(() => {
    audio.play('click');
    haptic();
  }, [haptic]);

  const value = useMemo<GameContextValue>(
    () => ({
      progress,
      account,
      screen,
      selectedWorld,
      loaded,
      serverOnline,
      go,
      playWorld,
      addCoins,
      addGems,
      spendCoins,
      spendGems,
      gainXp,
      buyMove,
      equipMove,
      ownsMove,
      buySkin,
      setSkin,
      recordWorldRun,
      recordBattle,
      recordDeath,
      addCodex,
      activateBoost,
      applyEntitlement,
      updateSettings,
      setAcceptedPolicies,
      signInWithSession,
      signOut,
      refreshAccount,
      deleteAccount,
      resetAllProgress,
      syncNow,
      haptic,
      click,
    }),
    [
      progress,
      account,
      screen,
      selectedWorld,
      loaded,
      serverOnline,
      go,
      playWorld,
      addCoins,
      addGems,
      spendCoins,
      spendGems,
      gainXp,
      buyMove,
      equipMove,
      ownsMove,
      buySkin,
      setSkin,
      recordWorldRun,
      recordBattle,
      recordDeath,
      addCodex,
      activateBoost,
      applyEntitlement,
      updateSettings,
      setAcceptedPolicies,
      signInWithSession,
      signOut,
      refreshAccount,
      deleteAccount,
      resetAllProgress,
      syncNow,
      haptic,
      click,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGame(): GameContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame must be used inside GameProvider');
  return v;
}

export { hasActiveBoost };
