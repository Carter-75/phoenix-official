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
  // Full theme record (visual spec Section 1.5). WORLDS names are canonical;
  // Temp-phoenix realm names are retired as display names.
  themeData: WorldTheme;
}

export interface EnemyData {
  id: string;
  type: 'bat' | 'slime' | 'golem' | 'boss' | 'projectile_player' | 'projectile_enemy' | 'aura' | 'coin' | 'gem' | 'heart' | 'xp_orb' | 'drill' | 'fire' | 'turret' | 'egg' | 'crate' | 'annihilation_fire' | 'enemy_phoenix';
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
}
