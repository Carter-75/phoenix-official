// Shared run-time types for the game page: the per-body data record
// every physics body carries, and the drop-table class membership
// sets. Moved out of game.component.ts in the code organization pass
// (Oct 27, 2026); declarations unchanged.
import { BossFightState } from '../../data/boss-rig';

export interface EnemyData {
  id: string;
  type: 'bat' | 'slime' | 'golem' | 'imp' | 'wisp' | 'pod' | 'mite' | 'sentry_shard' | 'seedmother' | 'rift_mine' | 'shieldback' | 'pyre_moth' | 'phantom' | 'wraith' | 'chanter' | 'serpent' | 'darter' | 'boss' | 'projectile_player' | 'projectile_enemy' | 'aura' | 'coin' | 'gem' | 'heart' | 'xp_orb' | 'spark_cell' | 'overcharge' | 'drill' | 'fire' | 'turret' | 'egg' | 'crate' | 'annihilation_fire' | 'enemy_phoenix' | 'dart' | 'talon' | 'spark' | 'lance' | 'nova';
  health: number;
  maxHealth: number;
  lastAttackTime?: number;
  lastMinionTime?: number;
  burstDamage?: number; // Custom damage payload
  value?: number;
  aiAbilities?: { id: string; level: number }[]; // For Battle Mode
  owner?: 'player' | 'enemy';
  ownerId?: string;
  immortalUntil?: number;
  weaveValue?: number; // Gloomwing weave sine, published for the renderer's banking
  // S2 move payload fields (mirrors models/game.models.ts EnemyData).
  moveId?: string;
  pierce?: boolean;
  hitIds?: string[];
  targetId?: string;
  meteorRushUntil?: number;
  meteorRushDamage?: number;
  meteorRushHits?: string[];
  // Stage 3 behavior state machine fields (mirror models/game.models.ts).
  behaviorState?: string;
  stateUntil?: number;
  telegraphStart?: number;
  dashDirX?: number;
  dashDirY?: number;
  orbitDir?: number;
  aimDirX?: number;
  aimDirY?: number;
  nextAimAt?: number;
  // Stage 4 behavior fields (mirror models/game.models.ts).
  motherId?: string;
  sparkUntil?: number;
  infernoUntil?: number;
  // Stage 5 behavior fields (mirror models/game.models.ts).
  buffUntil?: number;
  lastPulseAt?: number;
  anchorX?: number;
  anchorY?: number;
  passFired?: boolean;
  trail?: Array<{ x: number, y: number }>;
  segmentPositions?: Array<{ x: number, y: number }>;
  // S4: ultimate cast id on projectiles (boss HP cap enforcement).
  ultCastId?: string;
  // Stage 9 boss rig fields (mirror models/game.models.ts).
  bossState?: BossFightState;
  bossPattern?: boolean;
  // S6 fields (mirror models/game.models.ts): World 10 elite
  // tint, World 10 summon alternation, contact cadence timestamp.
  elite?: boolean;
  summonAlt?: boolean;
  lastContactAt?: number;
}

// Drop-table class membership (spec Sections 1.2 and 5.4, stage S5).
// Speed classes: Swift (Wisp, Mite, Pyre Moth, Serpent) and Dart
// (Gloomwing, Cinder Imp on its dash, Storm Darter on its passes)
// feed the Spark Cell roll. Toughness classes: Sturdy and up (Brood
// Pod, Sentry Shard, and everything tougher) raise the heart rate;
// Armored and up (Bastion Golem, Seedmother, Shieldback, and the
// Elite Loom Serpent) feed the Overcharge roll; the Serpent is the
// roster's one Elite and feeds the gem roll.
export const SPARK_CELL_TYPES = new Set(['bat', 'imp', 'wisp', 'mite', 'pyre_moth', 'serpent', 'darter']);
export const STURDY_UP_TYPES = new Set(['pod', 'sentry_shard', 'golem', 'seedmother', 'shieldback', 'serpent']);
export const ARMORED_UP_TYPES = new Set(['golem', 'seedmother', 'shieldback', 'serpent']);
