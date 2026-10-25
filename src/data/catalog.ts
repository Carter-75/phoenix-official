// Game catalog: worlds, moves, skins, trophies.
// Worlds and the 75-move catalog come from Temp-phoenix (Carter's first version),
// kept verbatim in names, damage, cooldowns, costs, and descriptions.

export type MoveType = 'hold' | 'double' | 'triple';

export interface Move {
  id: string;
  name: string;
  type: MoveType;
  damage: number;
  cooldownMs: number;
  cost: number;
  description: string;
  color: string;
}

export interface World {
  id: number;
  name: string;
  boss: string;
  theme: string;
  color: string;
  dark: string;
  description: string;
  bossHealth: number;
  enemyHealth: number;
  enemyDamage: number;
  waveCount: number;
}

export const WORLDS: World[] = [
  { id: 1, name: 'Ember Plains', boss: 'Inferno Guardian', theme: 'Fire', color: '#ff4444', dark: '#2a0a08', description: 'Where your journey begins. Face the flames of creation.', bossHealth: 600, enemyHealth: 30, enemyDamage: 8, waveCount: 3 },
  { id: 2, name: 'Shadow Realm', boss: 'Shadow Lord', theme: 'Dark', color: '#9a6bff', dark: '#12081f', description: 'Darkness whispers secrets. Can you hear them?', bossHealth: 900, enemyHealth: 45, enemyDamage: 10, waveCount: 3 },
  { id: 3, name: 'Crystal Caverns', boss: 'Crystal Titan', theme: 'Crystal', color: '#44aaff', dark: '#081826', description: 'Shimmering formations hide ancient power.', bossHealth: 1250, enemyHealth: 60, enemyDamage: 12, waveCount: 4 },
  { id: 4, name: 'Storm Peaks', boss: 'Storm Wyvern', theme: 'Lightning', color: '#ffd944', dark: '#221f08', description: 'Thunder echoes through the mountain heights.', bossHealth: 1650, enemyHealth: 80, enemyDamage: 14, waveCount: 4 },
  { id: 5, name: 'Void Nexus', boss: 'Void Reaper', theme: 'Void', color: '#c44dff', dark: '#170826', description: 'Where reality bends and breaks.', bossHealth: 2100, enemyHealth: 100, enemyDamage: 16, waveCount: 4 },
  { id: 6, name: 'Phoenix Sanctum', boss: 'Phoenix King', theme: 'Holy Fire', color: '#ffaa00', dark: '#261806', description: 'The sacred realm of the phoenix lords.', bossHealth: 2700, enemyHealth: 125, enemyDamage: 18, waveCount: 5 },
  { id: 7, name: 'Frozen Wastes', boss: 'Ice Empress', theme: 'Ice', color: '#88ccff', dark: '#0a1a26', description: 'Eternal winter grips this desolate land.', bossHealth: 3400, enemyHealth: 150, enemyDamage: 20, waveCount: 5 },
  { id: 8, name: 'Dragon Throne', boss: 'Dragon Emperor', theme: 'Ancient', color: '#ff8800', dark: '#241204', description: 'Where dragons once ruled supreme.', bossHealth: 4200, enemyHealth: 180, enemyDamage: 23, waveCount: 5 },
  { id: 9, name: 'Chaos Dimension', boss: 'Chaos Demon', theme: 'Chaos', color: '#ff00ff', dark: '#260226', description: 'Madness incarnate awaits the worthy.', bossHealth: 5200, enemyHealth: 215, enemyDamage: 26, waveCount: 6 },
  { id: 10, name: 'Eternal Flame', boss: 'Eternal Phoenix', theme: 'Divine', color: '#ffffff', dark: '#26221a', description: 'The final trial. Will you ascend?', bossHealth: 6500, enemyHealth: 250, enemyDamage: 30, waveCount: 6 },
];

type MoveTuple = [string, number, number, number, string];

const HOLD: MoveTuple[] = [
  ["Dragon's Breath", 75, 10000, 100, 'Intense flame torrent'],
  ['Solar Flare', 100, 12000, 200, 'Blinding solar energy'],
  ['Inferno Wave', 125, 15000, 350, 'Devastating fire wave'],
  ['Phoenix Nova', 150, 18000, 500, 'Explosive nova blast'],
  ['Cosmic Fire', 200, 20000, 750, 'Otherworldly flames'],
  ['Void Flame', 225, 22000, 1000, 'Flames from the void'],
  ['Divine Wrath', 250, 25000, 1300, 'Righteous fire'],
  ['Eternal Burn', 300, 30000, 1800, 'Flames that never die'],
  ['Star Fire', 350, 35000, 2500, 'Fire of a dying star'],
  ['Genesis Flame', 400, 40000, 3500, 'The first flame of creation'],
  ['Apocalypse Beam', 450, 45000, 5000, 'End of worlds'],
  ['Phoenix Rebirth', 500, 50000, 7000, 'Rise from ashes'],
  ['Celestial Pyre', 600, 60000, 10000, "Heaven's fire"],
  ['Quantum Flame', 700, 70000, 15000, 'Fire beyond reality'],
  ['Omega Blaze', 800, 80000, 20000, 'The final flame'],
  ['Primordial Fire', 1000, 100000, 30000, 'Fire before time'],
  ['Universal Burn', 1200, 120000, 45000, 'Burn all existence'],
  ['Infinity Flame', 1500, 150000, 75000, 'Endless burning'],
  ['Reality Melt', 2000, 180000, 100000, 'Melt reality itself'],
  ['God Slayer', 2500, 200000, 150000, 'Even gods fear this flame'],
  ['Transcendent Fire', 3000, 240000, 200000, 'Beyond mortal comprehension'],
  ['Absolute Zero-Sum', 4000, 300000, 300000, 'The ultimate paradox'],
  ['Phoenix Singularity', 5000, 360000, 500000, 'Collapse into flame'],
  ['Eternal Phoenix', 10000, 600000, 1000000, 'The phoenix that burns forever'],
];

const DOUBLE: MoveTuple[] = [
  ['Flame Burst', 20, 1200, 50, 'Rapid fire burst'],
  ['Fire Lance', 25, 1000, 100, 'Piercing flame spear'],
  ['Spark Storm', 30, 800, 150, 'Multiple fire sparks'],
  ['Blaze Bullet', 35, 600, 250, 'High-speed fire bullet'],
  ['Meteor Dash', 45, 500, 400, 'Lightning-fast meteor'],
  ['Phoenix Talon', 50, 450, 600, 'Sharp flame claw'],
  ['Solar Shard', 60, 400, 850, 'Crystallized sunlight'],
  ['Fire Needle', 70, 350, 1200, 'Precise flame strike'],
  ['Plasma Bolt', 80, 300, 1600, 'Superheated matter'],
  ['Quantum Dart', 100, 250, 2200, 'Probability-warping projectile'],
  ['Void Spike', 120, 200, 3000, 'Spike from nothingness'],
  ['Divine Arrow', 150, 180, 4000, "Heaven's judgment"],
  ['Star Fragment', 180, 160, 5500, 'Piece of a star'],
  ['Time Pierce', 220, 140, 7500, 'Pierce through time'],
  ['Reality Cut', 260, 120, 10000, 'Cut reality itself'],
  ['Dimensional Slice', 300, 100, 15000, 'Slice between dimensions'],
  ['Concept Killer', 400, 90, 25000, 'Kill abstract concepts'],
  ['Logic Breaker', 500, 80, 40000, 'Break the laws of logic'],
  ['Truth Denier', 700, 70, 60000, 'Deny fundamental truths'],
  ['Existence Eraser', 1000, 60, 100000, 'Erase from existence'],
  ['Omnipotence Shard', 1500, 50, 150000, 'Fragment of ultimate power'],
  ['Infinity Needle', 2000, 40, 250000, 'Needle of infinite sharpness'],
  ['Absolute Strike', 3000, 30, 400000, 'The perfect attack'],
  ['One-Shot Phoenix', 99999, 300000, 1000000, 'One shot, one kill. Always.'],
];

const TRIPLE: MoveTuple[] = [
  ['Phoenix Claw', 45, 3500, 75, 'Powerful claw attack'],
  ['Flame Tornado', 60, 3000, 150, 'Spinning fire vortex'],
  ['Fire Storm', 75, 2500, 300, 'Chaotic flame storm'],
  ['Solar Bomb', 90, 2000, 450, 'Explosive solar energy'],
  ['Phoenix Fury', 120, 1800, 650, 'Ultimate phoenix rage'],
  ['Meteor Strike', 140, 1600, 900, 'Devastating meteor impact'],
  ['Supernova', 160, 1400, 1200, 'Stellar explosion'],
  ['Galactic Burst', 200, 1200, 1600, 'Power of galaxies'],
  ['Dimensional Rift', 250, 1000, 2200, 'Tear through dimensions'],
  ['Time Collapse', 300, 900, 3000, 'Collapse time itself'],
  ['Reality Storm', 350, 800, 4000, 'Storm that changes reality'],
  ['Void Implosion', 400, 750, 5500, 'Implosion of nothingness'],
  ['Divine Judgment', 500, 700, 7500, 'Judgment of the gods'],
  ['Cosmic Annihilation', 600, 650, 10000, 'Annihilate cosmic structures'],
  ['Universal Destruction', 800, 600, 15000, 'Destroy entire universes'],
  ['Multiverse Collapse', 1000, 550, 25000, 'Collapse the multiverse'],
  ['Omniversal End', 1500, 500, 40000, 'End all possible realities'],
  ['Transcendence Break', 2000, 450, 60000, 'Break transcendence itself'],
  ['Absolute Deletion', 3000, 400, 100000, 'Delete absolutely everything'],
  ['Perfect Annihilation', 4000, 350, 150000, 'Perfect and complete annihilation'],
  ['Ultimate Genesis', 6000, 300, 250000, 'Create and destroy simultaneously'],
  ['Final Phoenix', 8000, 250, 400000, 'The last phoenix'],
  ['Eternal Moment', 12000, 200, 700000, 'An eternal moment of destruction'],
  ['Phoenix Omega', 20000, 100, 1000000, 'The beginning and end of all phoenixes'],
];

function buildMoves(): Move[] {
  const moves: Move[] = [
    { id: 'hold_1', name: 'Phoenix Inferno', type: 'hold', damage: 50, cooldownMs: 8000, cost: 0, description: 'Channel a massive fire beam', color: '#ff4444' },
    { id: 'double_1', name: 'Fire Dart', type: 'double', damage: 15, cooldownMs: 1500, cost: 0, description: 'Quick fire projectile', color: '#ff6644' },
    { id: 'triple_1', name: 'Phoenix Strike', type: 'triple', damage: 35, cooldownMs: 4000, cost: 0, description: 'Powerful flame burst', color: '#ff8844' },
  ];
  const groups: Array<[MoveType, MoveTuple[], string]> = [
    ['hold', HOLD, '#ff2222'],
    ['double', DOUBLE, '#ff6644'],
    ['triple', TRIPLE, '#ff8844'],
  ];
  for (const [type, tuples, color] of groups) {
    tuples.forEach(([name, damage, cooldownMs, cost, description], i) => {
      moves.push({ id: `${type}_${i + 2}`, name, type, damage, cooldownMs, cost, description, color });
    });
  }
  return moves;
}

export const MOVES: Move[] = buildMoves();
export const MOVE_BY_ID: Record<string, Move> = Object.fromEntries(MOVES.map((m) => [m.id, m]));

export interface Skin {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  gemCost: number;
  passOnly?: boolean;
}

// Fire / Ice / Eclipse come from Phoenix-Fall's three phoenix themes.
export const SKINS: Skin[] = [
  { id: 'ember', name: 'Ember Phoenix', primary: '#ff6a00', secondary: '#ffb347', accent: '#ff2222', gemCost: 0 },
  { id: 'frost', name: 'Frost Phoenix', primary: '#33bbff', secondary: '#aee6ff', accent: '#0055ff', gemCost: 40 },
  { id: 'eclipse', name: 'Eclipse Phoenix', primary: '#8a2be2', secondary: '#d8b4fe', accent: '#4b0082', gemCost: 40 },
  { id: 'solar', name: 'Solar Phoenix', primary: '#ffd700', secondary: '#fff3b0', accent: '#ff8800', gemCost: 80 },
  { id: 'verdant', name: 'Verdant Phoenix', primary: '#22cc66', secondary: '#b6ffc9', accent: '#0a7a3d', gemCost: 80 },
  { id: 'celestial', name: 'Celestial Phoenix', primary: '#ffe9f6', secondary: '#ffffff', accent: '#ff7ad9', gemCost: 0, passOnly: true },
];

export const SKIN_BY_ID: Record<string, Skin> = Object.fromEntries(SKINS.map((s) => [s.id, s]));

export interface Trophy {
  id: string;
  name: string;
  description: string;
}

export const TROPHIES: Trophy[] = [
  { id: 'first_boss', name: 'First Ashes', description: 'Defeat your first boss' },
  { id: 'world_5', name: 'Halfway to the Flame', description: 'Complete world 5' },
  { id: 'world_10', name: 'Eternal Flame', description: 'Complete world 10' },
  { id: 'level_10', name: 'Rising Heat', description: 'Reach level 10' },
  { id: 'level_25', name: 'Blaze', description: 'Reach level 25' },
  { id: 'collector_10', name: 'Move Collector', description: 'Own 10 moves' },
  { id: 'collector_all', name: 'Full Arsenal', description: 'Own all 75 moves' },
  { id: 'battle_1', name: 'Duelist', description: 'Win your first battle' },
  { id: 'battle_25', name: 'Phoenix Champion', description: 'Win 25 battles' },
  { id: 'rich_1000', name: 'Wealthy', description: 'Hold 1,000 coins at once' },
  { id: 'gem_hoarder', name: 'Gem Hoarder', description: 'Hold 10 gems at once' },
];

// Enemy codex entries. Keys are recorded when the player defeats that foe.
export const CODEX: Array<{ id: string; name: string; kind: string; blurb: string }> = [
  { id: 'chaser', name: 'Ember Whelp', kind: 'Chaser', blurb: 'Dives straight at the phoenix. Weak, fast, relentless.' },
  { id: 'shooter', name: 'Ash Sniper', kind: 'Shooter', blurb: 'Holds its distance and fires bolts. Close the gap quickly.' },
  { id: 'tank', name: 'Obsidian Brute', kind: 'Tank', blurb: 'Slow and heavily armored. Hold moves melt it.' },
  ...WORLDS.map((w) => ({
    id: `boss_${w.id}`,
    name: w.boss,
    kind: `Boss - World ${w.id} (${w.name})`,
    blurb: `Guardian of ${w.name}. ${w.description}`,
  })),
  { id: 'rival', name: 'Rival Phoenix', kind: 'Battle Mode', blurb: 'The AI phoenix of Battle Mode. Mirrors your moves and hunts you down.' },
];

export const xpForLevel = (level: number) => Math.floor(100 * Math.pow(1.2, level - 1));
