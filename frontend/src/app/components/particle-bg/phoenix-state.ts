// Render-side state records for the drawn phoenix and its pooled
// entities. Pure types: no behavior lives here. Moved out of
// particle-bg.component.ts in the code organization pass (Oct 27,
// 2026); field meanings are documented at each declaration.
//
// Bird Rebuild Round (Oct 28, 2026): the bird is a drawn sprite rig
// (phoenix-sprite.ts), not a particle formation. The 4000-point
// silhouette SAMPLING survives only as data (basePositions and the
// routing arrays): the turret companion and the codex enemy_phoenix
// builders copy that data, and entity-sync animates them from it.
// Nothing renders the player's or rival's points any more.
import * as THREE from 'three';

export interface PhoenixState {
  theme: string;
  group: THREE.Group;
  // The drawn bird: main plane, ash plane (death and rebirth
  // crossfade), and the fading ghost ribbon of recent positions.
  sprite: THREE.Mesh | null;
  ashSprite: THREE.Mesh | null;
  ghostSprites: THREE.Mesh[];
  glow: THREE.Sprite | null;
  basePositions: Float32Array;
  // Per-point routing from the silhouette sampling (0 ribbon, 1
  // inner fill, 2 outer fringe) plus the Celestial sparkle subset.
  // Data only now: colorForPoint reads them for the entity builders
  // that copy the bird's construction.
  inFill: Uint8Array;
  bufferIndex: Uint16Array;
  pointRegion: Uint8Array;
  sparkle: Uint8Array;
  skinId: string;
  flapRate: number;
  climbTime: number;
  // Systems S1 steering feel (spec Section 2.1): reversal spool state.
  // spoolT is seconds since the current reversal spool began, or -1
  // when no spool is running. wasDashing edges the dash entry flash.
  spoolT: number;
  wasDashing: boolean;
  wasDrilling: boolean;
  wasRushing: boolean; // S2: Meteor Rush entry flash edge
  flashUntil: number;
  reformUntil: number;
  glowSpanFactor: number;
  phoenixCount: number;
  currentBank: number;
  flapTime: number;
  // Bird Rebuild render state: the sprite is oriented in screen
  // space (its up is the heading), so heading is a smoothed angle,
  // not a quaternion. drillSpin accumulates the in-plane corkscrew
  // while drilling. The render* fields are the per-substep base
  // material state the physics writes; the component's visual-state
  // machine (flash, death, rebirth) composes over them.
  headingAngle: number;
  drillSpin: number;
  trailFade: number; // ghost ribbon strength from live speed (0 parked, 1 at pace)
  renderOpacity: number;
  renderTint: THREE.Color;
  renderAshMix: number;
  hovering: boolean;

  position: THREE.Vector3;
  velocity: THREE.Vector3;
  previousVelocity: THREE.Vector3;
  
  targetWaypoint: THREE.Vector3;
  
  historyPos: THREE.Vector3[];
  historyQuat: THREE.Quaternion[];
}

export interface ParticleEntity {
  mesh: THREE.Points;
  type: string;
  basePositions?: Float32Array;
  timeOffset?: number;
  // Shared damage feedback state (visual spec Section 3.1), fed by the
  // shared entity builder: the pristine colors and the per-vertex core
  // layer flags are what the hit flash pulses and what dynamic color
  // effects (Glob membrane crawl, Golem charge glow) rewrite from.
  baseColors?: Float32Array;
  layerFlags?: Uint8Array;
  lastHealth?: number;
  flashStartMs?: number;
  flashDurationMs?: number;
  flashActive?: boolean;
  // Bastion Golem telegraph state: the accumulated rock orbit angle
  // (its rate scales with the shot charge) and the last seen charge.
  orbitAngle?: number;
  lastCharge?: number;
  bornMs?: number;
  // Stage 10: the Chaos Demon's three form geometries (World 9
  // boss only); the render loop flows the live positions between
  // the previous and current form across each switch's first
  // second.
  formGeos?: Array<{ positions: Float32Array; colors: Float32Array }>;
  // Animation budget state (visual spec Section 1.4): true while this
  // enemy renders transform-only instead of full vertex animation.
  budgeted?: boolean;
  // Stage 4 one-frame latches: the Shieldback spark flash and the
  // Pyre Moth fuse strobe write colors every frame while active and
  // restore the pristine builder colors on the frame they end.
  wasSparking?: boolean;
  wasFusing?: boolean;
}

// A dead enemy's points, kept on screen briefly: they scatter outward
// and cool over 0.4 s (visual spec Section 3.1 death burst), then the
// pooled object is disposed. Positions and colors are snapshots taken
// at the moment of death so the burst starts from the animated shape.
export interface DyingBurst {
  mesh: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  startMs: number;
}
