// Render-side state records for the particle phoenix and its pooled
// entities. Pure types: no behavior lives here. Moved out of
// particle-bg.component.ts in the code organization pass (Oct 27,
// 2026); field meanings are documented at each declaration.
import * as THREE from 'three';

export interface PhoenixState {
  theme: string;
  group: THREE.Group;
  particles: THREE.Points;
  fillParticles: THREE.Points | null;
  core: THREE.Mesh | null;
  glow: THREE.Sprite | null;
  basePositions: Float32Array;
  // Per-point routing into the two particle buffers (main ribbon and
  // fringe in `particles`, inner body fill in `fillParticles`) plus the
  // sampling region (0 ribbon, 1 inner fill, 2 outer fringe).
  inFill: Uint8Array;
  bufferIndex: Uint16Array;
  pointRegion: Uint8Array;
  sparkle: Uint8Array;
  ashVec: Float32Array;
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
