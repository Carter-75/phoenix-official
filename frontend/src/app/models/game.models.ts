export interface AbilityData {
  level: number; 
  modifiers: Record<string, number>;
}

export interface WorldStats {
  maxHealth: number;
  speed: number;
  magnetism: number;
  damage: number;
  attackSpeed: number;
  burstDamage: number;
  auraRadius: number;
  homingLevel: number;
  attackRange: number;
  unlockedAbilities: Record<string, AbilityData>;
  activeTapAbility: string | null;
  activeHoldAbility: string | null;
  // Systems S1 (spec Section 3.2): the double-tap and triple-tap equip
  // slots beside the existing tap and hold slots. Added through the same
  // defaulting the record already uses (BASE_STATS carries nulls and
  // currentStats merges it), so pre-S1 saves load with empty slots.
  activeDoubleAbility: string | null;
  activeTripleAbility: string | null;
  // Systems S3 (spec Section 5.3): the gadget slot. Gadgets are bought
  // per world with coins and equipped outside the move slots; each
  // fires at most once per run under its own trigger. Additive fields
  // with the same defaulting as the S1 slots, so older saves load with
  // no gadgets owned and none equipped.
  unlockedGadgets: string[];
  activeGadget: string | null;
}

export interface PhysicsEntity {
  id: string;
  x: number;
  y: number;
  type: string;
  size: number;
  width?: number;
  height?: number;
  isLeft?: boolean;
  ownerId?: string;
  // Renderer-only feedback data (visual spec Section 3.1): current and
  // max health drive the shared hit flash and the boss phase flashes;
  // attackCharge (0 to 1) drives the Bastion Golem's telegraphed orbit
  // charge; weave (-1 to 1) is the Gloomwing's current weave deflection,
  // used to bank its mesh. None of these affect gameplay.
  health?: number;
  maxHealth?: number;
  attackCharge?: number;
  weave?: number;
  // Stage 4 renderer data: facing (radians, screen space: x right,
  // y down) is the direction the Shieldback's shield face and the
  // Sentry Shard's core eye point; sparkUntil is the ms timestamp
  // until which the Shieldback's rim flashes after a reduced frontal
  // hit. Display only.
  facing?: number;
  sparkUntil?: number;
  // Behavior state for the Stage 3 and Stage 4 types (the Cinder Imp's
  // approach, telegraph, dash, tired cycle; the Aether Wisp's close,
  // orbit, dart, return cycle; the Sentry Shard's drift and anchored
  // states; the Pyre Moth's chase and fusing states), published so the
  // renderer can read telegraphs off the body itself. Display only;
  // gameplay reads the same field on EnemyData.
  state?: string;
}

export type Rgb = [number, number, number];

export interface EnemyVariantDef {
  baseType: string; // roster type this variant restyles (design name)
  name: string; // variant display name in this world
  tweak: string; // the palette swap plus the one geometry tweak; hitbox and behavior are unchanged
}

// World theme record (visual spec DESIGN-OVERHAUL.md Section 1.5, values
// from the Section 4 theme sheets). Data only in Stage 0: no renderer reads
// these fields yet; later stages build sky, parallax, atmosphere, ground
// band, and enemy variants from them.
export interface WorldTheme {
  palette: {
    bright: Rgb;
    mid: Rgb;
    deep: Rgb;
    hostile: Rgb; // shared magenta-red family for enemy intent in every world
    pickupSafe: boolean; // confirms pickup colors (coin, gem, heart, XP) are untouched by this theme
  };
  sky: {
    glow: Rgb;
    intensity: number; // relative strength of the background glow plane
    position: string; // where the glow sits (low, top, center, corner, and so on)
    secondaryGlow: Rgb | null; // second glow for aurora, nebula, or rift effects
    description: string;
  };
  parallaxFar: { motifs: string[]; scrollFactor: number }; // far layer scrolls at about 4 percent of player speed feel
  parallaxMid: { motifs: string[]; scrollFactor: number }; // mid layer at about 12 percent
  atmosphere: {
    kind: string;
    direction: 'rising' | 'falling' | 'horizontal' | 'suspended' | 'mixed';
    speed: 'slow' | 'moderate' | 'fast';
    density: 'sparse' | 'moderate' | 'dense'; // always inside the spec Section 1.4 particle budget
    description: string;
  };
  ground: {
    band: string | null; // horizon band motif; null only for Abyssal Rift, which has no horizon band
    description: string;
  };
  enemyVariants: EnemyVariantDef[];
  uiAccent: string; // the world's one UI accent: the existing gradient class
}

export interface World {
  id: number;
  name: string;
  theme: string;
  textColorClass: string;
  isComingSoon?: boolean;
  // Boss identity ported from Temp-phoenix (see data/temp-catalog.ts)
  bossName?: string;
  bossTheme?: string;
  // The phoenix skin this world assigns to the player bird (visual
  // spec addendum, Oct 25, 2026): skins are automatic per world, never
  // player-selected and never stored. The id resolves through
  // phoenixSkinById in particle-bg.component.ts.
  skinId: string;
  // Full theme record (visual spec Section 1.5). WORLDS names are canonical;
  // Temp-phoenix realm names are retired as display names.
  themeData: WorldTheme;
}

export interface EnemyData {
  id: string;
  type: 'bat' | 'slime' | 'golem' | 'imp' | 'wisp' | 'pod' | 'mite' | 'sentry_shard' | 'seedmother' | 'rift_mine' | 'shieldback' | 'pyre_moth' | 'boss' | 'projectile_player' | 'projectile_enemy' | 'aura' | 'coin' | 'gem' | 'heart' | 'xp_orb' | 'drill' | 'fire' | 'turret' | 'egg' | 'crate' | 'annihilation_fire' | 'enemy_phoenix' | 'dart' | 'talon' | 'spark' | 'lance';
  health: number;
  maxHealth: number;
  lastAttackTime?: number;
  lastMinionTime?: number;
  burstDamage?: number;
  value?: number;
  aiAbilities?: { id: string; level: number }[];
  owner?: 'player' | 'enemy';
  ownerId?: string;
  immortalUntil?: number;
  // S2 move payload fields. moveId names the casting move on every
  // S2 projectile; pierce and hitIds implement Fire Lance (a piercing
  // projectile records each enemy it has already damaged); targetId
  // is the Spark Storm homing assignment (an enemy id, or the
  // '__player__' sentinel when an enemy cast seeks the player bird).
  moveId?: string;
  pierce?: boolean;
  hitIds?: string[];
  targetId?: string;
  // S2: Meteor Rush per-cast state, stored on an enemy_phoenix body
  // when the rival rushes (the player path keeps its state on the
  // game component next to the drill state).
  meteorRushUntil?: number;
  meteorRushDamage?: number;
  meteorRushHits?: string[];
  // Gloomwing weave: the steering loop stores the current sine value
  // here each tick so the renderer can bank the mesh in sync (visual
  // spec Section 3.3). Steering data only; never read by gameplay.
  weaveValue?: number;
  // Stage 3 behavior state machines (Cinder Imp charger, Aether Wisp
  // orbiter, Mite swarmer). The steering hook owns these fields; the
  // renderer reads behaviorState through the published PhysicsEntity
  // state for the telegraph and tired reads.
  behaviorState?: string; // imp: approach | telegraph | dash | tired; wisp: close | orbit | dart | return
  stateUntil?: number; // ms timestamp the current state ends
  telegraphStart?: number; // ms timestamp the imp telegraph began (drives the swell)
  dashDirX?: number; // locked dash or dart direction (unit vector)
  dashDirY?: number;
  orbitDir?: number; // wisp orbit sense, +1 or -1, fixed per body
  aimDirX?: number; // mite current hop aim (unit vector), re-rolled every 0.4 s
  aimDirY?: number;
  nextAimAt?: number; // ms timestamp of the mite's next re-aim
  // Stage 4 behavior fields (roster batch B).
  motherId?: string; // rift_mine: id of the Seedmother that laid it (the 4-mine field cap counts these)
  sparkUntil?: number; // shieldback: ms timestamp the spark-off rim flash ends
  infernoUntil?: number; // enemy_phoenix: ms timestamp an active Phoenix Inferno channel ends
}
