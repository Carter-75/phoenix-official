import { World, WorldStats } from '../models/game.models';

export const WORLDS: World[] = [
  { id: 0, name: 'Ember Wastes', theme: 'orange', textColorClass: 'from-orange-400 to-red-600' },
  { id: 1, name: 'Cerulean Depths', theme: 'blue', textColorClass: 'from-blue-400 to-cyan-600' },
  { id: 2, name: 'Amethyst Void', theme: 'purple', textColorClass: 'from-purple-400 to-fuchsia-600', isComingSoon: true },
  { id: 3, name: 'Verdant Canopy', theme: 'green', textColorClass: 'from-green-400 to-emerald-600', isComingSoon: true },
  { id: 4, name: 'Ashen Peaks', theme: 'gray', textColorClass: 'from-gray-300 to-gray-600', isComingSoon: true },
  { id: 5, name: 'Crystal Caverns', theme: 'cyan', textColorClass: 'from-cyan-300 to-blue-500', isComingSoon: true },
  { id: 6, name: 'Neon Nebula', theme: 'magenta', textColorClass: 'from-fuchsia-400 to-pink-600', isComingSoon: true },
  { id: 7, name: 'Golden Sands', theme: 'yellow', textColorClass: 'from-yellow-300 to-amber-600', isComingSoon: true },
  { id: 8, name: 'Blood Moon', theme: 'crimson', textColorClass: 'from-red-500 to-rose-800', isComingSoon: true },
  { id: 9, name: 'Abyssal Rift', theme: 'void', textColorClass: 'from-slate-700 to-black', isComingSoon: true },
];

export const ABILITIES: Record<string, { id: string, type: 'tap' | 'hold', name: string, desc: string, icon: string, unlockCost: number, upgradeCost: number, baseCooldown: number }> = {
  'drill_attack': { id: 'drill_attack', type: 'tap', name: 'Drill Attack', desc: 'Spin dash through enemies', icon: '🌪️', unlockCost: 500, upgradeCost: 200, baseCooldown: 20 },
  'fire_breath': { id: 'fire_breath', type: 'tap', name: 'Fire Breath', desc: 'Continuous short-range flame', icon: '🔥', unlockCost: 500, upgradeCost: 200, baseCooldown: 8 },
  'burst': { id: 'burst', type: 'tap', name: 'Burst', desc: 'Explosive radial attack', icon: '💥', unlockCost: 0, upgradeCost: 350, baseCooldown: 5 },
  
  'phoenix_turret': { id: 'phoenix_turret', type: 'hold', name: 'Phoenix Turret', desc: 'Drop an egg that hatches a turret', icon: '🥚', unlockCost: 800, upgradeCost: 300, baseCooldown: 12 },
  'rebirth': { id: 'rebirth', type: 'hold', name: 'Rebirth (Passive)', desc: 'Revive upon death with shockwave', icon: '✨', unlockCost: 1000, upgradeCost: 500, baseCooldown: 60 },
  'aura': { id: 'aura', type: 'hold', name: 'Aura', desc: 'Continuous damage zone', icon: '🌀', unlockCost: 0, upgradeCost: 400, baseCooldown: 15 },
};

export const REALM_ABILITIES: Record<number, string[]> = {
  0: ['drill_attack', 'fire_breath', 'burst', 'phoenix_turret', 'rebirth', 'aura']
};

export const BASE_STATS: WorldStats = { 
  maxHealth: 100, speed: 2.0, magnetism: 1.0, damage: 10, attackSpeed: 1.0, 
  burstDamage: 20, auraRadius: 250, homingLevel: 0, attackRange: 400,
  unlockedAbilities: {}, 
  activeTapAbility: null, activeHoldAbility: null
};

export const WORLD_0_STATS: WorldStats = { 
  ...BASE_STATS,
  unlockedAbilities: { 
    'burst': { level: 1, modifiers: { cooldown: 1.0, damage: 1.0, radius: 1.0 } }, 
    'aura': { level: 1, modifiers: { damage: 1.0, radius: 1.0 } } 
  }, 
  activeTapAbility: 'burst', activeHoldAbility: 'aura'
};

export const ABILITY_UPGRADE_TARGETS: Record<string, { targetLevel: number, stats: Record<string, number> }> = {
  drill_attack: { targetLevel: 30, stats: { cooldown: 0.25, speed: 3.0, duration: 5.0 } },
  burst: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0, radius: 3.0 } },
  phoenix_turret: { targetLevel: 30, stats: { cooldown: 0.5, duration: 3.0, damage: 3.0 } },
  fire_breath: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0, range: 3.0, ammo: 3.0 } },
  aura: { targetLevel: 30, stats: { damage: 5.0, radius: 3.0 } },
  rebirth: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } }
};
