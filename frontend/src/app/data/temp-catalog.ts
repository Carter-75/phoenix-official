// Ported from Temp-phoenix as DATA (audit recommendation): the 10 world
// and boss identities and the full 75-move catalog. Temp-phoenix code is
// not used anywhere; this file is pure content for this game.
//
// Boss health values are Temp-phoenix numbers in Temp-phoenix damage
// economy and are kept for reference and codex display. In-game boss HP
// uses this game's own scaling from data/balance.constants.ts
// (1000 x 1.42^worldIndex; growth base adopted Oct 25, 2026).

export interface TempWorldDef {
  id: number; // 1-based, pairs with this game's world index + 1
  name: string;
  boss: string;
  theme: string;
  description: string;
  bossHealth: number;
}

export const TEMP_WORLDS: TempWorldDef[] = [
  { id: 1, name: 'Ember Plains', boss: 'Cinder Colossus', theme: 'Fire', description: 'Where your journey begins. Face the flames of creation.', bossHealth: 600 },
  { id: 2, name: 'Shadow Realm', boss: 'Umbral Matriarch', theme: 'Dark', description: 'Darkness whispers secrets. Can you hear them?', bossHealth: 900 },
  { id: 3, name: 'Crystal Caverns', boss: 'Prism Sentinel', theme: 'Crystal', description: 'Shimmering formations hide ancient power.', bossHealth: 1250 },
  { id: 4, name: 'Storm Peaks', boss: 'Tempest Roc', theme: 'Lightning', description: 'Thunder echoes through the mountain heights.', bossHealth: 1650 },
  { id: 5, name: 'Void Nexus', boss: 'Grave Warden', theme: 'Void', description: 'Where reality bends and breaks.', bossHealth: 2100 },
  { id: 6, name: 'Phoenix Sanctum', boss: 'Solar Monarch', theme: 'Holy Fire', description: 'The sacred realm of the phoenix lords.', bossHealth: 2700 },
  { id: 7, name: 'Frozen Wastes', boss: 'Glacial Oracle', theme: 'Ice', description: 'Eternal winter grips this desolate land.', bossHealth: 3400 },
  { id: 8, name: 'Dragon Throne', boss: 'Wyrm Sovereign', theme: 'Ancient', description: 'Where dragons once ruled supreme.', bossHealth: 4200 },
  { id: 9, name: 'Chaos Dimension', boss: 'Entropy Engine', theme: 'Chaos', description: 'Madness incarnate awaits the worthy.', bossHealth: 5200 },
  { id: 10, name: 'Eternal Flame', boss: 'Phoenix Ascendant', theme: 'Divine', description: 'The final trial. Will you ascend?', bossHealth: 6500 },
];

export type TempMoveType = 'hold' | 'double' | 'triple';

export interface TempMove {
  id: string;
  name: string;
  type: TempMoveType; // hold = channeled, double = double-tap, triple = triple-tap
  damage: number;
  cooldownMs: number;
  cost: number; // coins, in Temp-phoenix economy
  description: string;
}

export const TEMP_MOVES: TempMove[] = [
  { id: 'hold_1', name: 'Phoenix Inferno', type: 'hold', damage: 50, cooldownMs: 8000, cost: 0, description: 'Channel a massive fire beam' },
  { id: 'double_1', name: 'Fire Dart', type: 'double', damage: 15, cooldownMs: 1500, cost: 0, description: 'Quick fire projectile' },
  { id: 'triple_1', name: 'Phoenix Strike', type: 'triple', damage: 35, cooldownMs: 4000, cost: 0, description: 'Powerful flame burst' },
  { id: 'hold_2', name: 'Dragon\'s Breath', type: 'hold', damage: 75, cooldownMs: 10000, cost: 100, description: 'Intense flame torrent' },
  { id: 'hold_3', name: 'Solar Flare', type: 'hold', damage: 100, cooldownMs: 12000, cost: 200, description: 'Blinding solar energy' },
  { id: 'hold_4', name: 'Inferno Wave', type: 'hold', damage: 125, cooldownMs: 15000, cost: 350, description: 'Devastating fire wave' },
  { id: 'hold_5', name: 'Phoenix Nova', type: 'hold', damage: 150, cooldownMs: 18000, cost: 500, description: 'Explosive nova blast' },
  { id: 'hold_6', name: 'Cosmic Fire', type: 'hold', damage: 200, cooldownMs: 20000, cost: 750, description: 'Otherworldly flames' },
  { id: 'hold_7', name: 'Void Flame', type: 'hold', damage: 225, cooldownMs: 22000, cost: 1000, description: 'Flames from the void' },
  { id: 'hold_8', name: 'Divine Wrath', type: 'hold', damage: 250, cooldownMs: 25000, cost: 1300, description: 'Righteous fire' },
  { id: 'hold_9', name: 'Eternal Burn', type: 'hold', damage: 300, cooldownMs: 30000, cost: 1800, description: 'Flames that never die' },
  { id: 'hold_10', name: 'Star Fire', type: 'hold', damage: 350, cooldownMs: 35000, cost: 2500, description: 'Fire of a dying star' },
  { id: 'hold_11', name: 'Genesis Flame', type: 'hold', damage: 400, cooldownMs: 40000, cost: 3500, description: 'The first flame of creation' },
  { id: 'hold_12', name: 'Apocalypse Beam', type: 'hold', damage: 450, cooldownMs: 45000, cost: 5000, description: 'End of worlds' },
  { id: 'hold_13', name: 'Phoenix Rebirth', type: 'hold', damage: 500, cooldownMs: 50000, cost: 7000, description: 'Rise from ashes' },
  { id: 'hold_14', name: 'Celestial Pyre', type: 'hold', damage: 600, cooldownMs: 60000, cost: 10000, description: 'Heaven\'s fire' },
  { id: 'hold_15', name: 'Quantum Flame', type: 'hold', damage: 700, cooldownMs: 70000, cost: 15000, description: 'Fire beyond reality' },
  { id: 'hold_16', name: 'Omega Blaze', type: 'hold', damage: 800, cooldownMs: 80000, cost: 20000, description: 'The final flame' },
  { id: 'hold_17', name: 'Primordial Fire', type: 'hold', damage: 1000, cooldownMs: 100000, cost: 30000, description: 'Fire before time' },
  { id: 'hold_18', name: 'Universal Burn', type: 'hold', damage: 1200, cooldownMs: 120000, cost: 45000, description: 'Burn all existence' },
  { id: 'hold_19', name: 'Infinity Flame', type: 'hold', damage: 1500, cooldownMs: 150000, cost: 75000, description: 'Endless burning' },
  { id: 'hold_20', name: 'Reality Melt', type: 'hold', damage: 2000, cooldownMs: 180000, cost: 100000, description: 'Melt reality itself' },
  { id: 'hold_21', name: 'God Slayer', type: 'hold', damage: 2500, cooldownMs: 200000, cost: 150000, description: 'Even gods fear this flame' },
  { id: 'hold_22', name: 'Transcendent Fire', type: 'hold', damage: 3000, cooldownMs: 240000, cost: 200000, description: 'Beyond mortal comprehension' },
  { id: 'hold_23', name: 'Absolute Zero-Sum', type: 'hold', damage: 4000, cooldownMs: 300000, cost: 300000, description: 'The ultimate paradox' },
  { id: 'hold_24', name: 'Phoenix Singularity', type: 'hold', damage: 5000, cooldownMs: 360000, cost: 500000, description: 'Collapse into flame' },
  { id: 'hold_25', name: 'Eternal Phoenix', type: 'hold', damage: 10000, cooldownMs: 600000, cost: 1000000, description: 'The phoenix that burns forever' },
  { id: 'double_2', name: 'Flame Burst', type: 'double', damage: 20, cooldownMs: 1200, cost: 50, description: 'Rapid fire burst' },
  { id: 'double_3', name: 'Fire Lance', type: 'double', damage: 25, cooldownMs: 1000, cost: 100, description: 'Piercing flame spear' },
  { id: 'double_4', name: 'Spark Storm', type: 'double', damage: 30, cooldownMs: 800, cost: 150, description: 'Multiple fire sparks' },
  { id: 'double_5', name: 'Blaze Bullet', type: 'double', damage: 35, cooldownMs: 600, cost: 250, description: 'High-speed fire bullet' },
  { id: 'double_6', name: 'Meteor Dash', type: 'double', damage: 45, cooldownMs: 500, cost: 400, description: 'Lightning-fast meteor' },
  { id: 'double_7', name: 'Phoenix Talon', type: 'double', damage: 50, cooldownMs: 450, cost: 600, description: 'Sharp flame claw' },
  { id: 'double_8', name: 'Solar Shard', type: 'double', damage: 60, cooldownMs: 400, cost: 850, description: 'Crystallized sunlight' },
  { id: 'double_9', name: 'Fire Needle', type: 'double', damage: 70, cooldownMs: 350, cost: 1200, description: 'Precise flame strike' },
  { id: 'double_10', name: 'Plasma Bolt', type: 'double', damage: 80, cooldownMs: 300, cost: 1600, description: 'Superheated matter' },
  { id: 'double_11', name: 'Quantum Dart', type: 'double', damage: 100, cooldownMs: 250, cost: 2200, description: 'Probability-warping projectile' },
  { id: 'double_12', name: 'Void Spike', type: 'double', damage: 120, cooldownMs: 200, cost: 3000, description: 'Spike from nothingness' },
  { id: 'double_13', name: 'Divine Arrow', type: 'double', damage: 150, cooldownMs: 180, cost: 4000, description: 'Heaven\'s judgment' },
  { id: 'double_14', name: 'Star Fragment', type: 'double', damage: 180, cooldownMs: 160, cost: 5500, description: 'Piece of a star' },
  { id: 'double_15', name: 'Time Pierce', type: 'double', damage: 220, cooldownMs: 140, cost: 7500, description: 'Pierce through time' },
  { id: 'double_16', name: 'Reality Cut', type: 'double', damage: 260, cooldownMs: 120, cost: 10000, description: 'Cut reality itself' },
  { id: 'double_17', name: 'Dimensional Slice', type: 'double', damage: 300, cooldownMs: 100, cost: 15000, description: 'Slice between dimensions' },
  { id: 'double_18', name: 'Concept Killer', type: 'double', damage: 400, cooldownMs: 90, cost: 25000, description: 'Kill abstract concepts' },
  { id: 'double_19', name: 'Logic Breaker', type: 'double', damage: 500, cooldownMs: 80, cost: 40000, description: 'Break the laws of logic' },
  { id: 'double_20', name: 'Truth Denier', type: 'double', damage: 700, cooldownMs: 70, cost: 60000, description: 'Deny fundamental truths' },
  { id: 'double_21', name: 'Existence Eraser', type: 'double', damage: 1000, cooldownMs: 60, cost: 100000, description: 'Erase from existence' },
  { id: 'double_22', name: 'Omnipotence Shard', type: 'double', damage: 1500, cooldownMs: 50, cost: 150000, description: 'Fragment of ultimate power' },
  { id: 'double_23', name: 'Infinity Needle', type: 'double', damage: 2000, cooldownMs: 40, cost: 250000, description: 'Needle of infinite sharpness' },
  { id: 'double_24', name: 'Absolute Strike', type: 'double', damage: 3000, cooldownMs: 30, cost: 400000, description: 'The perfect attack' },
  { id: 'double_25', name: 'One-Shot Phoenix', type: 'double', damage: 99999, cooldownMs: 300000, cost: 1000000, description: 'One shot, one kill. Always.' },
  { id: 'triple_2', name: 'Phoenix Claw', type: 'triple', damage: 45, cooldownMs: 3500, cost: 75, description: 'Powerful claw attack' },
  { id: 'triple_3', name: 'Flame Tornado', type: 'triple', damage: 60, cooldownMs: 3000, cost: 150, description: 'Spinning fire vortex' },
  { id: 'triple_4', name: 'Fire Storm', type: 'triple', damage: 75, cooldownMs: 2500, cost: 300, description: 'Chaotic flame storm' },
  { id: 'triple_5', name: 'Solar Bomb', type: 'triple', damage: 90, cooldownMs: 2000, cost: 450, description: 'Explosive solar energy' },
  { id: 'triple_6', name: 'Phoenix Fury', type: 'triple', damage: 120, cooldownMs: 1800, cost: 650, description: 'Ultimate phoenix rage' },
  { id: 'triple_7', name: 'Meteor Strike', type: 'triple', damage: 140, cooldownMs: 1600, cost: 900, description: 'Devastating meteor impact' },
  { id: 'triple_8', name: 'Supernova', type: 'triple', damage: 160, cooldownMs: 1400, cost: 1200, description: 'Stellar explosion' },
  { id: 'triple_9', name: 'Galactic Burst', type: 'triple', damage: 200, cooldownMs: 1200, cost: 1600, description: 'Power of galaxies' },
  { id: 'triple_10', name: 'Dimensional Rift', type: 'triple', damage: 250, cooldownMs: 1000, cost: 2200, description: 'Tear through dimensions' },
  { id: 'triple_11', name: 'Time Collapse', type: 'triple', damage: 300, cooldownMs: 900, cost: 3000, description: 'Collapse time itself' },
  { id: 'triple_12', name: 'Reality Storm', type: 'triple', damage: 350, cooldownMs: 800, cost: 4000, description: 'Storm that changes reality' },
  { id: 'triple_13', name: 'Void Implosion', type: 'triple', damage: 400, cooldownMs: 750, cost: 5500, description: 'Implosion of nothingness' },
  { id: 'triple_14', name: 'Divine Judgment', type: 'triple', damage: 500, cooldownMs: 700, cost: 7500, description: 'Judgment of the gods' },
  { id: 'triple_15', name: 'Cosmic Annihilation', type: 'triple', damage: 600, cooldownMs: 650, cost: 10000, description: 'Annihilate cosmic structures' },
  { id: 'triple_16', name: 'Universal Destruction', type: 'triple', damage: 800, cooldownMs: 600, cost: 15000, description: 'Destroy entire universes' },
  { id: 'triple_17', name: 'Multiverse Collapse', type: 'triple', damage: 1000, cooldownMs: 550, cost: 25000, description: 'Collapse the multiverse' },
  { id: 'triple_18', name: 'Omniversal End', type: 'triple', damage: 1500, cooldownMs: 500, cost: 40000, description: 'End all possible realities' },
  { id: 'triple_19', name: 'Transcendence Break', type: 'triple', damage: 2000, cooldownMs: 450, cost: 60000, description: 'Break transcendence itself' },
  { id: 'triple_20', name: 'Absolute Deletion', type: 'triple', damage: 3000, cooldownMs: 400, cost: 100000, description: 'Delete absolutely everything' },
  { id: 'triple_21', name: 'Perfect Annihilation', type: 'triple', damage: 4000, cooldownMs: 350, cost: 150000, description: 'Perfect and complete annihilation' },
  { id: 'triple_22', name: 'Ultimate Genesis', type: 'triple', damage: 6000, cooldownMs: 300, cost: 250000, description: 'Create and destroy simultaneously' },
  { id: 'triple_23', name: 'Final Phoenix', type: 'triple', damage: 8000, cooldownMs: 250, cost: 400000, description: 'The last phoenix' },
  { id: 'triple_24', name: 'Eternal Moment', type: 'triple', damage: 12000, cooldownMs: 200, cost: 700000, description: 'An eternal moment of destruction' },
  { id: 'triple_25', name: 'Phoenix Omega', type: 'triple', damage: 20000, cooldownMs: 100, cost: 1000000, description: 'The beginning and end of all phoenixes' },
];

export const TEMP_MOVES_BY_TYPE: Record<TempMoveType, TempMove[]> = {
  hold: TEMP_MOVES.filter(m => m.type === 'hold'),
  double: TEMP_MOVES.filter(m => m.type === 'double'),
  triple: TEMP_MOVES.filter(m => m.type === 'triple')
};
