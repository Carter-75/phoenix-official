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

export interface World {
  id: number;
  name: string;
  theme: string;
  textColorClass: string;
  isComingSoon?: boolean;
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
