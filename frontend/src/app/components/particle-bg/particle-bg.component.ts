import { Component, ElementRef, OnInit, OnDestroy, ViewChild, NgZone, effect, inject } from '@angular/core';
import { GameStateService, STAMINA } from '../../services/game-state.service';
import { AudioService } from '../../services/audio.service';
import { WORLDS, HOSTILE_RGB } from '../../constants/game.constants';
import { PhysicsEntity, WorldTheme } from '../../models/game.models';
import { buildEntityGeometry } from './entity-builder';
import * as THREE from 'three';

interface PhoenixState {
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

interface ParticleEntity {
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
interface DyingBurst {
  mesh: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  startMs: number;
}

// ---------------------------------------------------------------------------
// Phoenix skins (visual spec Section 2.4). A skin is a restyle record:
// palette, glyph edge treatment, glow, and trail style only. It never
// changes silhouette proportions, wingspan, animation timing, brightness
// rank, or collision (collision lives in the game component and never
// reads anything here). The particle silhouette and the wingspan are
// identical for every skin; the glyph edge treatments live in the core
// sprite, drawn inside the same bounding box for every skin.
// ---------------------------------------------------------------------------
type Rgb3 = [number, number, number];
interface PhoenixSkin {
  id: string;
  name: string;
  bright: Rgb3; mid: Rgb3; deep: Rgb3;
  glyph: { crest: 'tuft' | 'spikes' | 'swept' | 'rays' | 'leaf' | 'crown'; angular: boolean; serrated: boolean; darkHeart: boolean; facets: boolean; sparkles: boolean; broadWings: boolean };
  glowSpan: number; // multiple of wingspan (round 1 default is 1.35)
  glowRing: 'none' | 'eclipse' | 'halo';
  trailStyle: 'ember' | 'snow' | 'eclipse' | 'ribbon' | 'pollen' | 'sequence';
  trailA: Rgb3 | null; trailB: Rgb3 | null; // alternating tail spark colors (Celestial)
  flickerScale: number; // fill-point sampling jitter scale (Frost facets sit stiller)
}

export const PHOENIX_SKINS: PhoenixSkin[] = [
  { id: 'ember', name: 'Ember', bright: [1.0, 0.8, 0.2], mid: [1.0, 0.4, 0.0], deep: [0.8, 0.1, 0.0],
    glyph: { crest: 'tuft', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: false, broadWings: false },
    glowSpan: 1.35, glowRing: 'none', trailStyle: 'ember', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'frost', name: 'Frost', bright: [0.85, 0.98, 1.0], mid: [0.35, 0.65, 1.0], deep: [0.05, 0.2, 0.65],
    glyph: { crest: 'spikes', angular: true, serrated: false, darkHeart: false, facets: true, sparkles: false, broadWings: false },
    glowSpan: 1.35, glowRing: 'none', trailStyle: 'snow', trailA: null, trailB: null, flickerScale: 0.35 },
  { id: 'eclipse', name: 'Eclipse', bright: [0.92, 0.85, 1.0], mid: [0.55, 0.3, 0.95], deep: [0.12, 0.05, 0.25],
    glyph: { crest: 'swept', angular: false, serrated: false, darkHeart: true, facets: false, sparkles: false, broadWings: false },
    glowSpan: 1.4, glowRing: 'eclipse', trailStyle: 'eclipse', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'solar', name: 'Solar', bright: [1.0, 0.95, 0.75], mid: [1.0, 0.8, 0.2], deep: [0.85, 0.55, 0.05],
    glyph: { crest: 'rays', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: false, broadWings: true },
    glowSpan: 1.5, glowRing: 'none', trailStyle: 'ribbon', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'verdant', name: 'Verdant', bright: [0.7, 1.0, 0.3], mid: [0.15, 0.8, 0.25], deep: [0.02, 0.35, 0.08],
    glyph: { crest: 'leaf', angular: false, serrated: true, darkHeart: false, facets: false, sparkles: false, broadWings: false },
    glowSpan: 1.35, glowRing: 'none', trailStyle: 'pollen', trailA: null, trailB: null, flickerScale: 0.7 },
  { id: 'celestial', name: 'Celestial', bright: [1.0, 1.0, 1.0], mid: [0.45, 0.8, 1.0], deep: [0.1, 0.25, 0.75],
    glyph: { crest: 'crown', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: true, broadWings: false },
    glowSpan: 1.45, glowRing: 'halo', trailStyle: 'sequence', trailA: [0.55, 0.95, 1.0], trailB: [1.0, 0.85, 0.35], flickerScale: 1.0 },
];

// The battle rival bird: the master design in the hostile palette, as
// today (static crimson). Rival birds never use player skins (spec 2.4).
export const HOSTILE_SKIN: PhoenixSkin = {
  id: 'hostile', name: 'Hostile', bright: [1.0, 0.3, 0.3], mid: [0.8, 0.0, 0.0], deep: [0.5, 0.0, 0.0],
  glyph: { crest: 'tuft', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: false, broadWings: false },
  glowSpan: 1.35, glowRing: 'none', trailStyle: 'ember', trailA: null, trailB: null, flickerScale: 1.0,
};

export function phoenixSkinById(id: string): PhoenixSkin {
  return PHOENIX_SKINS.find(s => s.id === id) || PHOENIX_SKINS[0];
}

// The player bird's skin is derived from the world being played
// (visual spec addendum, Oct 25, 2026): each WORLDS entry carries the
// skinId it assigns, and there is no player selection or stored state
// anywhere. The menu bird and the Battle player bird read the same
// derivation from the menu-selected world; the rival never does.
export function phoenixSkinForWorld(worldIndex: number): PhoenixSkin {
  const world = WORLDS[Math.max(0, Math.min(WORLDS.length - 1, worldIndex))];
  return phoenixSkinById(world ? world.skinId : 'ember');
}

// Canonical phoenix outline in normalized bird space: nx is the wing
// axis (-1..1), nz is the body axis (0 at the beak tip, 1 at the tail
// plume tips). One outline for every skin: it drives both the
// inner-fill particle sampling and the core sprite glyph, so the two
// layers always agree. Drawn to read as an actual phoenix (visual spec
// addendum, Oct 25, 2026): a narrow beak spike, a round head clearly
// wider than the pinched neck behind it, swept wings with scalloped
// primary feathers on the trailing edge, a tapering body, and a tail
// that fans into five layered plumes (outer, mid, and the centre tip
// on the axis). Right half from the beak, clockwise; the full outline
// mirrors it.
const GLYPH_HALF: Array<[number, number]> = [
  // Beak: a narrow spike ahead of the head.
  [0.0, 0.0], [0.040, 0.045],
  // Head: round and wide, widest at the cheek, then the pinched neck.
  // The head and neck sit clearly ahead of the wings: the first
  // in-game iteration merged them into the wing dome and the bird
  // read as a mushroom, so the wing roots start further back now.
  [0.085, 0.055], [0.130, 0.100], [0.118, 0.145], [0.072, 0.180],
  // Chest and shoulder, widening into the wing root.
  [0.095, 0.215], [0.150, 0.245],
  // Wing leading edge, sweeping out and back to the pointed tip.
  [0.340, 0.245], [0.560, 0.275], [0.760, 0.325], [0.925, 0.390], [1.0, 0.455],
  // Wing trailing edge: three scalloped primary feathers back to the
  // rear wing root.
  [0.865, 0.510], [0.780, 0.462], [0.682, 0.535], [0.600, 0.485],
  [0.500, 0.548], [0.425, 0.502], [0.350, 0.555], [0.245, 0.525], [0.180, 0.565],
  // Body side, tapering to the hips.
  [0.152, 0.615], [0.136, 0.665],
  // Tail fan: outer plume, notch, mid plume, notch, centre plume tip.
  [0.155, 0.705], [0.238, 0.800], [0.332, 0.900], [0.410, 0.968],
  [0.298, 0.882], [0.233, 1.0], [0.128, 0.902], [0.0, 1.0],
];
export const GLYPH_OUTLINE: Array<[number, number]> = (() => {
  const pts: Array<[number, number]> = [...GLYPH_HALF];
  for (let i = GLYPH_HALF.length - 2; i >= 1; i--) pts.push([-GLYPH_HALF[i][0], GLYPH_HALF[i][1]]);
  return pts;
})();

function pointInGlyph(nx: number, nz: number): boolean {
  // Ray cast against GLYPH_OUTLINE.
  let inside = false;
  const poly = GLYPH_OUTLINE;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > nz) !== (zj > nz) && nx < ((xj - xi) * (nz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

@Component({
  selector: 'app-particle-bg',
  standalone: true,
  template: `<canvas #bgCanvas id="bg-canvas"></canvas>`,
  styles: [`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: -50;
      background: #020205;
      pointer-events: auto;
    }
    #bg-canvas {
      width: 100%;
      height: 100%;
    }
  `]
})
export class ParticleBgComponent implements OnInit, OnDestroy {
  @ViewChild('bgCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private gameState = inject(GameStateService);
  private audioService = inject(AudioService);
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private particles!: THREE.Points;
  private lavaFlowsGroup!: THREE.Group;
  private bgGlow!: THREE.Mesh;
  private sideArtGroup!: THREE.Group;

  // Stage 6 theme scenes (visual spec Sections 1.5 and 4): the sky
  // treatment, parallax silhouette layers, ground band, and
  // atmosphere behavior are driven by each world's Stage 0 themeData
  // record. A world joins this set when its theme batch lands
  // (batch 1: Worlds 1 to 3; batch 2 in Stage 7: Worlds 4 to 6;
  // batch 3 in Stage 8: Worlds 7 to 10). As of Stage 8 the set
  // covers every world in the game.
  private static readonly THEME_SCENE_WORLDS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Stage 6 theme backdrop: ONE opaque plane carrying the world's
  // whole painted backdrop (sky gradient, baked sky glows, far and
  // mid silhouette layers, ground strip). The layers are composited
  // into a single canvas texture instead of living on separate
  // transparent planes: under the harness's software renderer each
  // full-screen transparent layer cost tens of ms per frame (a
  // same-day A/B measured 206 ms themed vs 67 ms base with separate
  // planes), while one opaque quad costs about the same as the
  // shipped glow plane it replaces. The ambient particle field sits
  // at z >= -30, in front of the backdrop at z = -44, so nothing
  // gameplay-facing is occluded.
  private backdropMesh: THREE.Mesh | null = null;
  private backdropTex: THREE.CanvasTexture | null = null;
  private blobTexture: THREE.Texture | null = null;
  private themedWorldIndex = -1;
  private themeTime = 0;
  private atmosphereDir: 'rising' | 'falling' | 'horizontal' | 'suspended' | 'mixed' = 'falling';
  private atmosphereSpeed = 1.8; // the shipped drift, kept for unthemed worlds
  private atmosphereCount = 4500;
  // Stage 7: Ashen Peaks' falling ash rides a slow sideways wind
  // sine (World 5 sheet). Zero everywhere else, so the shipped
  // falling behavior is byte-identical for the other worlds.
  private atmosphereSway = 0;
  // Stage 8: Blood Moon's rain falls at a slight angle (World 9
  // sheet): a constant sideways drift on the falling branch.
  // Zero everywhere else.
  private atmosphereDriftX = 0;
  // Stage 8, World 9: the blood moon is a small canvas-textured
  // plane in front of the backdrop (never a full-screen layer;
  // see the Stage 6 backdrop note for why that distinction is
  // the whole performance story). Its lit fraction follows the
  // world BGM position, the same clock the wave composer phases
  // on, so the moon is the run's clock exactly as its sheet
  // says. The canvas repaints only when the quantized lit step
  // changes.
  private moonMesh: THREE.Mesh | null = null;
  private moonCanvas: HTMLCanvasElement | null = null;
  private moonTex: THREE.CanvasTexture | null = null;
  private moonLit = 0.35; // menu default until a BGM clock exists
  private moonLitStep = -1;
  // Stage 8, World 10: the rift seam is two narrow additive
  // planes (a star-white core and a wider violet halo, slightly
  // angled against each other: the sheet's two glow planes)
  // standing in front of the backdrop. Narrow strips, not
  // full-screen layers, so their overdraw is a few percent of
  // the backdrop's. Their opacity pulses with the audio
  // intensity (spec Section 6: the one sky that reacts to the
  // audio system), smoothed so it breathes instead of flickering.
  private riftCoreMesh: THREE.Mesh | null = null;
  private riftHaloMesh: THREE.Mesh | null = null;
  private riftPulse = 0;
  // Stage 8, World 7: the aurora tint on the falling snow is
  // refreshed on an interval (the snow falls slowly; a point
  // crosses an aurora band over tens of seconds), never per
  // frame. themeTime of the last refresh.
  private lastAuroraTintAt = -10;
  // Dynamic pixel-ratio step-down state (spec Section 1.4).
  private frameEmaMs = 16;
  private pixelRatioStep = 0;
  private lastPrEvalMs = 0;
  private goldenAuraMesh!: THREE.Points;
  private celestialShieldMesh!: THREE.Points;
  private drillAuraMesh!: THREE.Points;
  private cosmicTrailMesh!: THREE.Points;
  private animationId!: number;
  
  private bird!: PhoenixState;
  private aiBird!: PhoenixState;
  private readonly MAX_HISTORY = 600;
  
  private boundX = 15;
  private boundY = 10;
  private birdScale = 0.5; // Scaled down
  private readonly ambientBoxSize = 80;

  // Canonical bird speed (playtest round 1, speed consistency). The bird
  // crosses the full visible width at its flight plane in this many
  // seconds at base stats, on every viewport and every refresh rate.
  // 1.4 s preserves the historical feel of the reference portrait phone
  // (412x915 at 60 Hz), where the old per-frame speed produced a crossing
  // of about 1.4 s. All bird motion is delta-time integrated against
  // this, so 90/120 Hz phones and landscape tablets now match it.
  private static readonly BIRD_CROSSING_SECONDS = 1.4;
  private static readonly BASE_SPEED_STAT = 2.0;
  // The shipped speed stat is anchored at 2.0 (BASE_STATS.speed): before
  // the Oct 25, 2026 speed retune the stat fed the cruise multiplier raw,
  // so base stats cruised at (visibleWidth / 1.4) x 2.0, a nominal 0.70 s
  // crossing. The retune normalizes every stat-derived multiplier by
  // this base, so base stats yield exactly the canonical crossing and
  // each upgrade step keeps its relative size (a step that raised pace
  // by X percent before still raises it by X percent).
  private lastFrameTime = 0;
  private trailAccumulator = 0;
  private glowTexture: THREE.Texture | null = null;

  private mouseTarget = new THREE.Vector3(0, -10, -15);
  private entityPool = new Map<string, ParticleEntity>();
  private dyingBursts: DyingBurst[] = [];
  private lastSyncMs = 0;
  private fullAnimIds = new Set<string>();
  private glyphTextures = new Map<string, THREE.Texture>();
  private ringGlowTexture: THREE.Texture | null = null;
  private haloGlowTexture: THREE.Texture | null = null;

  // Player-bird visual state machine for the Section 2.2 death and
  // rebirth sequences. Gameplay death and revive live in the game
  // component; this only animates what the signals already announce
  // (isDeadMenuOpen, isRebirthing, immortalUntil).
  private visState: 'alive' | 'dying' | 'dead' | 'rebirth' = 'alive';
  private visT0 = 0;
  private prevDeadMenu = false;
  private prevRebirthing = false;
  private lastImmortalSeen = 0;
  private ashStartPos = new Float32Array(4000 * 3);
  private ashStartCol = new Float32Array(4000 * 3);
  private rebirthTargetCol = new Float32Array(4000 * 3);

  // Trail tuning (spec Section 2.3): the visible tail spans about this
  // many seconds of flight history, constant at any refresh rate,
  // because history sampling below is computed in seconds, not frames.
  private static readonly TRAIL_SECONDS = 0.45;

  constructor(private ngZone: NgZone) {
    // The world drives both the ambient palette and the player bird's
    // skin (addendum: skins are per-world). This fires on menu world
    // selection and on mid-run realm transitions alike, so the bird
    // always wears the world it is flying through.
    effect(() => {
      const worldIndex = this.gameState.selectedWorldIndex();
      const theme = WORLDS[worldIndex].theme;
      this.updateColors(theme);
      this.applyThemeScene(worldIndex);
      if (this.bird) this.applySkin(phoenixSkinForWorld(worldIndex));
    });
  }
  
  ngOnInit() {
    this.initThree();
    this.createParticles();
    this.createCosmetics();
    
    this.bird = this.createBirdState('orange');
    this.initHistory(this.bird);
    this.createPhoenixMesh(this.bird, phoenixSkinForWorld(this.gameState.selectedWorldIndex()));

    this.aiBird = this.createBirdState('crimson'); // Different theme for AI
    this.initHistory(this.aiBird);
    this.createPhoenixMesh(this.aiBird, HOSTILE_SKIN);
    
    this.updateColors(WORLDS[this.gameState.selectedWorldIndex()].theme);
    this.applyThemeScene(this.gameState.selectedWorldIndex());

    // Test hook for the playtest harness, same pattern and same
    // localStorage gate as the game component's window.__phoenixS1:
    // scene statistics for the Stage 6 particle budget count check.
    // Inert unless the harness sets the flag before load.
    try {
      if (window.localStorage.getItem('phoenix_debug_hooks') === '1') {
        (window as any).__phoenixBg = {
          sceneStats: () => this.sceneStats(),
        };
      }
    } catch { /* storage unavailable: no hook, no effect on play */ }

    this.animate();
    
    // Bind once and keep the refs so removeEventListener actually works (avoids leaks / duplicate
    // listeners when the component is recreated).
    window.addEventListener('resize', this.boundResize);
    window.addEventListener('mousemove', this.boundMouseMove);
    // touchstart so a simple tap/hold (no drag) immediately moves the Phoenix — required for APK.
    window.addEventListener('touchstart', this.boundTouchMove, { passive: false });
    window.addEventListener('touchmove', this.boundTouchMove, { passive: false });
  }

  private boundResize = this.onResize.bind(this);
  private boundMouseMove = this.onMouseMove.bind(this);
  private boundTouchMove = this.onTouchMove.bind(this);

  ngOnDestroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('touchstart', this.boundTouchMove);
    window.removeEventListener('touchmove', this.boundTouchMove);
    this.renderer.dispose();
  }

  private updateColors(theme: string) {
    if (!this.particles || !this.bird || !this.bird.particles) return;

    let p1 = [1.0, 0.8, 0.2]; let p2 = [1.0, 0.4, 0.0]; let p3 = [0.8, 0.1, 0.0]; 
    if (theme === 'blue') { p1 = [0.2, 0.8, 1.0]; p2 = [0.0, 0.4, 1.0]; p3 = [0.0, 0.1, 0.8]; }
    else if (theme === 'purple') { p1 = [0.6, 0.0, 1.0]; p2 = [0.3, 0.0, 0.8]; p3 = [0.1, 0.0, 0.5]; }
    else if (theme === 'green') { p1 = [0.2, 1.0, 0.4]; p2 = [0.0, 0.8, 0.2]; p3 = [0.0, 0.4, 0.1]; }
    else if (theme === 'gray') { p1 = [0.9, 0.9, 0.9]; p2 = [0.5, 0.5, 0.5]; p3 = [0.2, 0.2, 0.2]; }
    else if (theme === 'cyan') { p1 = [0.4, 1.0, 1.0]; p2 = [0.0, 0.8, 1.0]; p3 = [0.0, 0.5, 0.8]; }
    else if (theme === 'magenta') { p1 = [1.0, 0.4, 1.0]; p2 = [0.8, 0.0, 0.8]; p3 = [0.5, 0.0, 0.5]; }
    else if (theme === 'yellow') { p1 = [1.0, 1.0, 0.2]; p2 = [0.8, 0.8, 0.0]; p3 = [0.5, 0.5, 0.0]; }
    else if (theme === 'crimson') { p1 = [1.0, 0.2, 0.2]; p2 = [0.8, 0.0, 0.0]; p3 = [0.5, 0.0, 0.0]; }
    else if (theme === 'void') { p1 = [0.2, 0.0, 0.4]; p2 = [0.1, 0.0, 0.2]; p3 = [0.0, 0.0, 0.0]; }

    // Skin and world hue collision (spec Section 2.4): where the
    // world's own skin shares the world's hue family, the ambient
    // field's mid band shifts one step toward its deep band so the
    // player bird stays the brightest object (rule 1.2.1). The bird
    // itself is not recolored by the world palette: its per-world
    // skin record overrides it for the bird only.
    const skin = phoenixSkinForWorld(this.gameState.selectedWorldIndex());
    const collideThemes: Record<string, string[]> = {
      frost: ['blue', 'cyan'], eclipse: ['purple', 'void'], solar: ['yellow'],
      verdant: ['green'], celestial: ['cyan', 'void'],
    };
    const p2a = (collideThemes[skin.id] || []).includes(theme)
      ? [p2[0] + (p3[0] - p2[0]) * 0.5, p2[1] + (p3[1] - p2[1]) * 0.5, p2[2] + (p3[2] - p2[2]) * 0.5]
      : p2;

    const aColors = this.particles.geometry.attributes['color'].array as Float32Array;
    for (let i = 0; i < aColors.length; i += 3) {
      const r = Math.random();
      if (r > 0.66) { aColors[i] = p1[0]; aColors[i+1] = p1[1]; aColors[i+2] = p1[2]; }
      else if (r > 0.33) { aColors[i] = p2a[0]; aColors[i+1] = p2a[1]; aColors[i+2] = p2a[2]; }
      else { aColors[i] = p3[0]; aColors[i+1] = p3[1]; aColors[i+2] = p3[2]; }
    }
    this.particles.geometry.attributes['color'].needsUpdate = true;

    // Player bird: colored by its skin, not the world (spec 2.4). While
    // a death or rebirth sequence owns the color buffers, leave them.
    if (this.visState === 'alive') this.applyBirdColors(this.bird, skin);
    // AI bird: hostile palette, statically, as today.
    if (this.aiBird && this.aiBird.particles) this.applyBirdColors(this.aiBird, HOSTILE_SKIN);


    if (this.bgGlow) {
        const mat = this.bgGlow.material as THREE.MeshBasicMaterial;
        mat.color.setRGB(p2[0], p2[1], p2[2]);
    }
  }

  // ------------------------------------------------------------------
  // Stage 6 theme scenes: sky, parallax, ground band, atmosphere.
  // Everything is driven by the world's Stage 0 themeData record;
  // the painters below are the batch 1 art (Worlds 1 to 3) and later
  // batches register theirs the same way. Brightness discipline from
  // spec Section 1.2 holds throughout: silhouettes are dark shapes
  // against the glow, atmosphere stays dimmer than pickups, and the
  // player bird (untouched here) remains the brightest object.
  // ------------------------------------------------------------------

  private applyThemeScene(worldIndex: number) {
    if (!this.scene || !this.bgGlow || !this.particles) return;
    const world = WORLDS[worldIndex];
    const td = world?.themeData;
    const themed = !!td && ParticleBgComponent.THEME_SCENE_WORLDS.has(worldIndex);
    this.themedWorldIndex = themed ? worldIndex : -1;

    // Sky: glow color, strength, and placement from the sheet. For
    // unthemed worlds the shipped flat treatment stays (updateColors
    // owns the glow color there; opacity and position reset here).
    const skyMat = this.bgGlow.material as THREE.MeshBasicMaterial;
    if (themed && td) {
      skyMat.color.setRGB(td.sky.glow[0], td.sky.glow[1], td.sky.glow[2]);
      skyMat.opacity = 0.15 * td.sky.intensity;
      this.bgGlow.position.y = td.sky.position === 'low' ? -17 : td.sky.position === 'top' ? 17 : 0;
    } else {
      skyMat.opacity = 0.15;
      this.bgGlow.position.y = 0;
    }

    // The sky glows (primary, plus World 3's secondary nebula glow)
    // are baked into the backdrop canvas in makeBackdropTexture,
    // composited additively over its dark base exactly as the
    // separate glow planes rendered them; the shipped glow plane is
    // hidden for themed worlds and restored for unthemed ones in
    // the backdrop block below.

    // The themed backdrop: one opaque plane whose canvas composites
    // the sky, the baked glows, the far and mid silhouette layers,
    // and the ground strip (see the field comment for why it is a
    // single plane). Unthemed worlds hide it and keep the shipped
    // glow plane exactly as before.
    const painters = themed && td ? this.themePainters(worldIndex) : null;
    if (painters && td) {
      if (!this.backdropMesh) {
        this.backdropMesh = new THREE.Mesh(new THREE.PlaneGeometry(460, 130), new THREE.MeshBasicMaterial({}));
        this.backdropMesh.position.set(0, -16, -44);
        this.scene.add(this.backdropMesh);
      }
      this.backdropTex?.dispose();
      this.backdropTex = this.makeBackdropTexture(painters, td);
      this.backdropTex.repeat.x = 2;
      const mat = this.backdropMesh.material as THREE.MeshBasicMaterial;
      mat.map = this.backdropTex; mat.needsUpdate = true;
      this.backdropMesh.visible = true;
      this.bgGlow.visible = false;
    } else {
      if (this.backdropMesh) this.backdropMesh.visible = false;
      this.bgGlow.visible = true;
    }

    // Atmosphere behavior from the sheet; unthemed worlds keep the
    // shipped falling drift at the moderate anchor and full budget.
    if (themed && td) {
      this.atmosphereDir = td.atmosphere.direction;
      this.atmosphereSpeed = td.atmosphere.speed === 'slow' ? 0.9 : td.atmosphere.speed === 'fast' ? 3.2 : 1.8;
      this.atmosphereCount = td.atmosphere.density === 'sparse' ? 3000 : td.atmosphere.density === 'dense' ? 4500 : 3750;
      // Ashen Peaks (world index 4) is the one world whose sheet
      // adds a sideways wind sine to its falling ash.
      this.atmosphereSway = worldIndex === 4 ? 1.6 : 0;
      // Blood Moon (world index 8) is the one world whose rain
      // falls at a slight angle: a constant drift on the fall.
      this.atmosphereDriftX = worldIndex === 8 ? -1.0 : 0;
    } else {
      this.atmosphereDir = 'falling';
      this.atmosphereSpeed = 1.8;
      this.atmosphereCount = 4500;
      this.atmosphereSway = 0;
      this.atmosphereDriftX = 0;
    }
    this.particles.geometry.setDrawRange(0, this.atmosphereCount);

    // Stage 8 per-world atmosphere colors that the shared
    // updateColors bands cannot express. updateColors has already
    // run for this world (the constructor effect calls it first),
    // so these passes own the ambient color buffer while their
    // world is selected, and the next world's updateColors pass
    // restores the standard bands.
    if (themed && worldIndex === 6) this.tintAuroraSnow();
    if (themed && worldIndex === 9) this.tintRiftMotes();

    // Stage 8 set pieces that are not part of the composited
    // backdrop: Blood Moon's moon (World 9) and Abyssal Rift's
    // seam (World 10). Each exists only in its own world.
    const wantMoon = themed && worldIndex === 8;
    if (wantMoon && !this.moonMesh) {
      this.moonCanvas = document.createElement('canvas');
      this.moonCanvas.width = 256; this.moonCanvas.height = 256;
      this.moonTex = new THREE.CanvasTexture(this.moonCanvas);
      this.moonMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(21, 21),
        new THREE.MeshBasicMaterial({ map: this.moonTex, transparent: true, depthWrite: false })
      );
      this.moonMesh.position.set(5, 20.5, -43.5);
      this.scene.add(this.moonMesh);
      this.moonLitStep = -1; // force the first paint
      this.updateMoon();
    }
    if (this.moonMesh) this.moonMesh.visible = wantMoon;

    const wantRift = themed && worldIndex === 9;
    if (wantRift && !this.riftCoreMesh) {
      const seamTex = this.makeSeamTexture();
      const coreMat = new THREE.MeshBasicMaterial({
        map: seamTex, color: new THREE.Color(0.95, 0.90, 1.0), transparent: true,
        opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      // Seam widths: a first cut (13-unit core, 44-unit halo)
      // washed the whole portrait frame in violet and broke
      // the darkest-world read in the Stage 8 menu census
      // (World 10 lum 41.0 vs Blood Moon 22.7), so the seam is
      // now a true seam: 5-unit core, 16-unit halo.
      this.riftCoreMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 150), coreMat);
      this.riftCoreMesh.position.set(7, 0, -43.4);
      this.riftCoreMesh.rotation.z = 0.035;
      this.scene.add(this.riftCoreMesh);
      const haloMat = new THREE.MeshBasicMaterial({
        map: seamTex, color: new THREE.Color(0.40, 0.13, 0.72), transparent: true,
        opacity: 0.19, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.riftHaloMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 150), haloMat);
      this.riftHaloMesh.position.set(7, 0, -43.6);
      this.riftHaloMesh.rotation.z = -0.025;
      this.scene.add(this.riftHaloMesh);
    }
    if (this.riftCoreMesh) this.riftCoreMesh.visible = wantRift;
    if (this.riftHaloMesh) this.riftHaloMesh.visible = wantRift;
  }

  // World 7 atmosphere color (Neon Nebula sheet): fine snow
  // drifting through colored light, each point tinted by the
  // aurora band it is in. The bands are horizontal: the top of
  // the field leans teal (the secondary glow), the middle keeps
  // the nebula magenta, the bottom deepens. A per-point shade
  // jitter keeps the snow from reading as three flat strata.
  // Called on world entry and refreshed on an interval from the
  // animation loop (snow crosses a band over tens of seconds,
  // so the tint never needs per-frame work).
  private tintAuroraSnow() {
    if (!this.particles) return;
    const td = WORLDS[6].themeData;
    const pos = this.particles.geometry.attributes['position'].array as Float32Array;
    const col = this.particles.geometry.attributes['color'].array as Float32Array;
    const bright = td.palette.bright, mid = td.palette.mid, deep = td.palette.deep;
    const teal = td.sky.secondaryGlow ?? [0.0, 0.9, 0.8];
    for (let i = 0; i < pos.length; i += 3) {
      const pi = i / 3;
      const jitter = 0.8 + 0.35 * (((pi * 2654435761) >>> 0) % 1000) / 1000;
      const y = pos[i + 1];
      let r: number, g: number, b: number;
      if (y > 13) { // top band: magenta leaning teal
        r = (bright[0] + (teal[0] - bright[0]) * 0.55) * jitter;
        g = (bright[1] + (teal[1] - bright[1]) * 0.55) * jitter;
        b = (bright[2] + (teal[2] - bright[2]) * 0.55) * jitter;
      } else if (y > -13) { // middle band: the nebula magenta
        r = mid[0] * jitter; g = mid[1] * jitter; b = mid[2] * jitter;
      } else { // bottom band: deep magenta, lifted so snow reads
        r = deep[0] * 1.5 * jitter; g = deep[1] * 1.5 * jitter; b = deep[2] * 1.5 * jitter;
      }
      col[i] = Math.min(1, r); col[i + 1] = Math.min(1, g); col[i + 2] = Math.min(1, b);
    }
    this.particles.geometry.attributes['color'].needsUpdate = true;
  }

  // World 10 atmosphere color (Abyssal Rift sheet): rift motes
  // and sparse static stars. One in ten points is a star (star
  // white at full brightness, and the motion branch holds it
  // still); the rest are motes in two violet depths.
  private tintRiftMotes() {
    if (!this.particles) return;
    const td = WORLDS[9].themeData;
    const col = this.particles.geometry.attributes['color'].array as Float32Array;
    const bright = td.palette.bright;
    for (let i = 0; i < col.length; i += 3) {
      const pi = i / 3;
      const h = (((pi * 2654435761) >>> 0) % 1000) / 1000;
      if (pi % 10 === 0) { col[i] = bright[0]; col[i + 1] = bright[1]; col[i + 2] = bright[2]; }
      else if (h < 0.45) { col[i] = 0.30; col[i + 1] = 0.05; col[i + 2] = 0.55; }
      else { col[i] = 0.10; col[i + 1] = 0.03; col[i + 2] = 0.22; }
    }
    this.particles.geometry.attributes['color'].needsUpdate = true;
  }

  // Blood Moon update (World 9 sheet): the moon waxes as the run
  // progresses. Progress is the world BGM position over its
  // duration, the composer's own phase clock (entity-spawner
  // phaseProgress), so the moon and the waves agree about what
  // time it is. Before any BGM clock exists (menu before the
  // track loads) the moon holds a mid crescent. The canvas
  // repaints only when the lit fraction crosses a 1/40 step.
  private updateMoon() {
    if (!this.moonMesh || !this.moonCanvas || !this.moonTex) return;
    const dur = this.audioService.getBgmDuration();
    let lit = 0.35;
    if (dur > 0) {
      const p = Math.min(1, Math.max(0, this.audioService.getBgmCurrentTime() / dur));
      lit = 0.08 + 0.92 * p;
    }
    this.moonLit = lit;
    const step = Math.round(lit * 40);
    if (step === this.moonLitStep) return;
    this.moonLitStep = step;
    const ctx = this.moonCanvas.getContext('2d')!;
    const cx = 128, cy = 128, r = 116;
    ctx.clearRect(0, 0, 256, 256);
    // The unlit side: a barely-there dark red disc, so the
    // moon's full circle reads even at crescent.
    ctx.fillStyle = this.silColor([0.30, 0.05, 0.05], 1.0, 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // The lit side, waxing from the right: the right limb arc,
    // closed by the terminator half-ellipse whose bulge flips
    // at half phase.
    ctx.fillStyle = this.silColor([0.62, 0.13, 0.10], 1.0, 1.0);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
    const rx = r * Math.abs(2 * lit - 1);
    if (lit < 0.5) ctx.ellipse(cx, cy, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
    else ctx.ellipse(cx, cy, rx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
    ctx.closePath(); ctx.fill();
    // Surface mottling on the lit face: a few soft dark patches,
    // clipped to the disc.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(10, 0, 0, 0.16)';
    const blotches: Array<[number, number, number]> = [[-30, -18, 26], [22, 30, 19], [38, -34, 14], [-8, 48, 12]];
    for (const [bx, by, br] of blotches) {
      ctx.beginPath(); ctx.ellipse(cx + bx, cy + by, br, br * 0.7, 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    this.moonTex.needsUpdate = true;
  }

  // Heart Pod beat (World 9 sheet: the cells visibly beat).
  // A double-thump scale pulse on a 1.15 s cycle: a strong
  // first beat, a softer second, then rest. Applied to Brood
  // Pod entities while Blood Moon is the selected world (see
  // the pod animation branch); it is the Heart Pod variant's
  // one tweak, in the renderer because a builder palette
  // cannot move.
  private heartBeatScale(timeOffset: number): number {
    const c = (Date.now() * 0.001 + timeOffset) % 1.15;
    let s = 0;
    if (c < 0.16) s = Math.sin((c / 0.16) * Math.PI) * 0.085;
    else if (c > 0.24 && c < 0.40) s = Math.sin(((c - 0.24) / 0.16) * Math.PI) * 0.05;
    return 1 + s;
  }

  // The rift seam's falloff texture: a horizontal gradient that
  // is bright at the center line and gone at the edges, shared
  // by the core and halo planes at different widths and colors.
  private makeSeamTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.38, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 8);
    return new THREE.CanvasTexture(canvas);
  }

  private sceneStats() {
    let livePoints = 0, pointsObjects = 0, objects = 0;
    if (this.scene) {
      this.scene.traverse((o) => {
        objects++;
        const pts = o as THREE.Points;
        if (pts.isPoints) {
          pointsObjects++;
          const geo = pts.geometry;
          const total = geo.attributes['position']?.count ?? 0;
          const drawn = geo.drawRange && geo.drawRange.count !== Infinity ? Math.min(geo.drawRange.count, total) : total;
          livePoints += drawn;
        }
      });
    }
    return {
      livePoints, pointsObjects, objects,
      pixelRatio: this.renderer ? this.renderer.getPixelRatio() : 0,
      themedWorldIndex: this.themedWorldIndex,
      atmosphereDir: this.atmosphereDir,
      atmosphereCount: this.atmosphereCount,
      atmosphereSway: this.atmosphereSway,
      atmosphereDriftX: this.atmosphereDriftX,
      moonLit: this.themedWorldIndex === 8 ? Math.round(this.moonLit * 100) / 100 : -1,
      riftPulse: this.themedWorldIndex === 9 ? Math.round(this.riftPulse * 100) / 100 : -1,
      frameEmaMs: Math.round(this.frameEmaMs * 10) / 10,
    };
  }

  private makeBlobTexture(): THREE.Texture {
    if (this.blobTexture) return this.blobTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    // The hot spot sits off center so the glow's slow rotation and
    // orbit read as motion instead of a static radial disc.
    const g = ctx.createRadialGradient(108, 128, 8, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.38)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    this.blobTexture = new THREE.CanvasTexture(canvas);
    return this.blobTexture;
  }

  private makeLayerTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(this.makeLayerCanvas(w, h, paint));
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  private makeLayerCanvas(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    paint(ctx, w, h);
    return canvas;
  }

  // Composites a world's whole backdrop into one canvas: a deep
  // vertical gradient from the palette, the sky glows baked with
  // additive compositing (the secondary glow included for World 3),
  // the far silhouette layer, the mid silhouette layer, and the
  // ground strip drawn at the v-band whose projection matches the
  // shipped ground line (its top edge about 85 percent down the
  // field; the strip keeps its own painted gradient and features).
  private makeBackdropTexture(painters: any, td: any): THREE.CanvasTexture {
    const W = 1024, H = 512;
    const farC = this.makeLayerCanvas(W, H, (c, w, h) => painters.far(c, w, h, td));
    const midC = this.makeLayerCanvas(W, H, (c, w, h) => painters.mid(c, w, h, td));
    const gndC = this.makeLayerCanvas(W, 128, (c, w, h) => painters.ground(c, w, h, td));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, this.silColor(td.palette.deep, 0.30));
    grad.addColorStop(0.55, this.silColor(td.palette.deep, 0.13));
    grad.addColorStop(1, this.silColor(td.palette.deep, 0.20));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const bakeGlow = (cx: number, cy: number, r: number, rgb: any, alpha: number) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const lin = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 2.2));
      g.addColorStop(0, `rgba(${lin(rgb[0])},${lin(rgb[1])},${lin(rgb[2])},${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    // Glow placement from the sheet's sky position. Golden Sands
    // (Stage 8) is the one off-center sky: a huge low sun baked
    // at the bottom-left corner. Blood Moon's glow rides high.
    // Abyssal Rift's primary light is the seam, which lives on
    // its own planes (applyThemeScene), so its backdrop takes
    // only the dim violet ambience of the secondary glow below.
    const gy = td.sky.position === 'low' ? H * 1.02 : td.sky.position === 'top' ? -H * 0.02
      : td.sky.position === 'high' ? H * 0.06 : td.sky.position === 'corner' ? H * 1.04 : H * 0.5;
    const gx = td.sky.position === 'corner' ? W * 0.08 : W / 2;
    const gr = td.sky.position === 'corner' ? W * 0.62 : W * 0.55;
    const ga = td.sky.position === 'off-center vertical rift' ? 0 : 0.15 * td.sky.intensity;
    bakeGlow(gx, gy, gr, td.sky.glow, ga);
    // The Rift's secondary wash is dimmer than the standard
    // bake: at 0.13 the broad violet glow kept World 10 within
    // noise of Blood Moon's menu luminance, and the sheet
    // calls the Rift the darkest world in the game (Stage 8
    // menu census, runs B and C: 22.0/22.7 then 22.4/22.0).
    const secAlpha = td.sky.position === 'off-center vertical rift' ? 0.07 : 0.13;
    if (td.sky.secondaryGlow) bakeGlow(W * 0.68, H * 0.30, W * 0.34, td.sky.secondaryGlow, secAlpha);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(farC, 0, 0);
    ctx.drawImage(midC, 0, 0);
    ctx.drawImage(gndC, 0, H * 0.59, W, H * 0.13);
    const tex = new THREE.CanvasTexture(canvas);
    // No sRGB texture format here on purpose: the harness's
    // software renderer pays a per-texel decode for sRGB sampling
    // (measured about +20 ms per frame), while real GPUs decode in
    // hardware for free. The painted colors are pre-linearized in
    // silColor and bakeGlow instead, which produces the same image
    // through the default (linear) texture path every other canvas
    // texture in the game already uses.
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  // Deterministic per-layer random source, so a world's silhouettes
  // are the same every visit (and identical in the harness).
  private themeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Backdrop paint color: the palette values are authored as sRGB,
  // but the backdrop texture renders through the default linear
  // path (see makeBackdropTexture), which brightens bytes on
  // output. Pre-linearizing each channel (gamma 2.2) makes the
  // rendered color match the authored one.
  private silColor(rgb: Rgb3, f: number, a = 1): string {
    const lin = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v * f)), 2.2));
    return `rgba(${lin(rgb[0])},${lin(rgb[1])},${lin(rgb[2])},${a})`;
  }

  // Draws the same shapes at x offsets -w, 0, +w so the repeating
  // texture wraps seamlessly.
  private tiled(ctx: CanvasRenderingContext2D, w: number, draw: () => void) {
    for (const ox of [-w, 0, w]) {
      ctx.save();
      ctx.translate(ox, 0);
      draw();
      ctx.restore();
    }
  }

  private themePainters(worldIndex: number) {
    switch (worldIndex) {
      case 0: return { far: this.paintEmberFar.bind(this), mid: this.paintEmberMid.bind(this), ground: this.paintGroundLava.bind(this) };
      case 1: return { far: this.paintDepthsFar.bind(this), mid: this.paintDepthsMid.bind(this), ground: this.paintGroundVents.bind(this) };
      case 2: return { far: this.paintVoidFar.bind(this), mid: this.paintVoidMid.bind(this), ground: this.paintGroundMirror.bind(this) };
      case 3: return { far: this.paintCanopyFar.bind(this), mid: this.paintCanopyMid.bind(this), ground: this.paintGroundForest.bind(this) };
      case 4: return { far: this.paintAshenFar.bind(this), mid: this.paintAshenMid.bind(this), ground: this.paintGroundAshRidge.bind(this) };
      case 5: return { far: this.paintCavernFar.bind(this), mid: this.paintCavernMid.bind(this), ground: this.paintGroundCrystal.bind(this) };
      case 6: return { far: this.paintNebulaFar.bind(this), mid: this.paintNebulaMid.bind(this), ground: this.paintGroundIce.bind(this) };
      case 7: return { far: this.paintSandsFar.bind(this), mid: this.paintSandsMid.bind(this), ground: this.paintGroundDune.bind(this) };
      case 8: return { far: this.paintBloodFar.bind(this), mid: this.paintBloodMid.bind(this), ground: this.paintGroundBloodRidge.bind(this) };
      case 9: return { far: this.paintRiftFar.bind(this), mid: this.paintRiftMid.bind(this), ground: this.paintGroundNone.bind(this) };
      default: return null;
    }
  }

  // World 1 far: black basalt spires and broken arches.
  private paintEmberFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(101);
    const fill = this.silColor(td.palette.deep, 0.32);
    const base = h * 0.99;
    ctx.fillStyle = fill;
    this.tiled(ctx, w, () => {
      let x = -20;
      while (x < w * 0.7) {
        const sw = 14 + rnd() * 32;
        const sh = h * (0.16 + rnd() * 0.20);
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + sw * 0.18, base - sh * 0.82);
        ctx.lineTo(x + sw * (0.38 + rnd() * 0.2), base - sh);
        ctx.lineTo(x + sw * (0.66 + rnd() * 0.16), base - sh * 0.78);
        ctx.lineTo(x + sw, base);
        ctx.closePath(); ctx.fill();
        x += sw + 6 + rnd() * 30;
      }
      // Broken arches: two pillars and a half-ring band, the opening
      // left transparent so the sky glow shows through the ruin.
      for (let k = 0; k < 2; k++) {
        const ax = w * (0.24 + 0.44 * k) + rnd() * 40;
        const aw = 84 + rnd() * 40, ah = h * (0.30 + rnd() * 0.10), pw = 16;
        ctx.fillRect(ax, base - ah, pw, ah);
        ctx.fillRect(ax + aw - pw, base - ah, pw, ah);
        ctx.beginPath();
        ctx.arc(ax + aw / 2, base - ah + pw, aw / 2 - pw / 2, Math.PI, 0);
        ctx.lineWidth = pw;
        ctx.strokeStyle = fill;
        ctx.stroke();
      }
    });
  }

  // World 1 mid: drifting slag boulders, rim-lit orange from below.
  private paintEmberMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(102);
    const fill = this.silColor(td.palette.deep, 0.45);
    const rim = this.silColor(td.palette.bright, 1.0, 0.30);
    this.tiled(ctx, w, () => {
      for (let k = 0; k < 12; k++) {
        const cx = rnd() * w, cy = h * (0.68 + rnd() * 0.26);
        const rx = 16 + rnd() * 26, ry = rx * (0.45 + rnd() * 0.2);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      }
    });
  }

  // World 2 far: sunken pillars and a ruined gate.
  private paintDepthsFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(201);
    const fill = this.silColor(td.palette.deep, 0.36);
    const base = h * 0.99;
    ctx.fillStyle = fill;
    this.tiled(ctx, w, () => {
      let x = 10;
      while (x < w * 0.75) {
        const pw = 20 + rnd() * 20;
        const broken = rnd() < 0.3;
        const top = broken ? h * (0.52 + rnd() * 0.14) : h * (0.34 + rnd() * 0.18);
        ctx.fillRect(x, top, pw, base - top);
        ctx.fillRect(x - 5, top - 11, pw + 10, 11); // capital
        x += pw + 44 + rnd() * 90;
      }
      // The ruined gate: two tall pillars and a lintel.
      const gx = w * 0.55, gw = 130, gt = h * 0.30;
      ctx.fillRect(gx, gt + 30, 34, base - gt - 30);
      ctx.fillRect(gx + gw - 34, gt + 44, 34, base - gt - 44);
      ctx.fillRect(gx - 12, gt, gw + 24, 26);
    });
  }

  // World 2 mid: slow jellyfish silhouettes drifting up.
  private paintDepthsMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(202);
    const fill = this.silColor(td.palette.deep, 0.45, 0.9);
    this.tiled(ctx, w, () => {
      for (let k = 0; k < 10; k++) {
        const cx = rnd() * w, cy = h * (0.10 + rnd() * 0.48);
        const r = 11 + rnd() * 15;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.72, 0, Math.PI, Math.PI * 2);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = fill; ctx.lineWidth = 4;
        for (let j = -1; j <= 1; j++) {
          ctx.beginPath();
          const sx = cx + j * r * 0.42;
          ctx.moveTo(sx, cy + 2);
          ctx.quadraticCurveTo(sx + 7, cy + r * 0.9, sx - 4, cy + r * 1.7);
          ctx.stroke();
        }
      }
    });
  }

  // World 3 far: giant floating crystal shards, slowly rotating in
  // the sheet (the layer drift and counter-shift carry the motion).
  private paintVoidFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(301);
    const fill = this.silColor(td.palette.deep, 0.55);
    const facet = this.silColor(td.palette.mid, 1.0, 0.4);
    this.tiled(ctx, w, () => {
      for (let k = 0; k < 7; k++) {
        const cx = rnd() * w, cy = h * (0.2 + rnd() * 0.55);
        const L = 42 + rnd() * 54, Wd = 11 + rnd() * 13, a = (rnd() - 0.5) * 1.1;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = facet; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
        ctx.restore();
      }
    });
  }

  // World 3 mid: smaller shard clusters drifting past.
  private paintVoidMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(302);
    const fill = this.silColor(td.palette.deep, 0.7);
    const facet = this.silColor(td.palette.mid, 1.0, 0.3);
    this.tiled(ctx, w, () => {
      for (let c = 0; c < 5; c++) {
        const ccx = rnd() * w, ccy = h * (0.15 + rnd() * 0.6);
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const cx = ccx + (rnd() - 0.5) * 100, cy = ccy + (rnd() - 0.5) * 70;
          const L = 16 + rnd() * 24, Wd = 6 + rnd() * 7, a = (rnd() - 0.5) * 1.4;
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = facet; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
          ctx.restore();
        }
      }
    });
  }

  // World 1 ground: a lava glow line with pulses traveling along it
  // (the render loop scrolls this texture slowly). The line is a sum
  // of whole-period sines so it wraps seamlessly.
  private paintGroundLava(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const yAt = (x: number) => 30 + 7 * Math.sin((2 * Math.PI * 3 * x) / w) + 4 * Math.sin((2 * Math.PI * 7 * x) / w + 1.3);
    // Deep glow wash under the line.
    const grad = ctx.createLinearGradient(0, 24, 0, h);
    grad.addColorStop(0, this.silColor(td.palette.mid, 1.0, 0.13));
    grad.addColorStop(1, this.silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 24, w, h - 24);
    // Rock mass below the line.
    ctx.fillStyle = this.silColor(td.palette.deep, 0.22);
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The lava line itself, with a soft bloom.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = this.silColor(td.palette.mid, 1.0, 0.95);
    ctx.lineWidth = 4;
    ctx.shadowColor = this.silColor(td.palette.mid, 1.0, 0.9);
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Brighter pulses spaced along the line.
    for (let x = 40; x < w; x += 128) {
      const g = ctx.createRadialGradient(x, yAt(x), 1, x, yAt(x), 17);
      g.addColorStop(0, this.silColor(td.palette.bright, 1.0, 0.55));
      g.addColorStop(1, this.silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - 17, yAt(x) - 17, 34, 34);
    }
  }

  // World 2 ground: abyssal dark with faint blue vent glows.
  private paintGroundVents(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(203);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, this.silColor(td.palette.deep, 0.05, 0));
    grad.addColorStop(0.35, this.silColor(td.palette.deep, 0.30));
    grad.addColorStop(1, this.silColor(td.palette.deep, 0.42));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) {
      const cx = rnd() * w, cy = 46 + rnd() * 54, r = 18 + rnd() * 30;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      g.addColorStop(0, this.silColor(td.palette.bright, 1.0, 0.16));
      g.addColorStop(1, this.silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = this.silColor(td.palette.bright, 1.0, 0.35);
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // World 3 ground: a fractured mirror plane, shimmer only.
  private paintGroundMirror(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(303);
    ctx.fillStyle = this.silColor(td.palette.deep, 0.30);
    ctx.fillRect(0, 18, w, h - 18);
    // The horizon reflects the glow in one broken streak.
    const grad = ctx.createLinearGradient(0, 18, 0, 34);
    grad.addColorStop(0, this.silColor(td.palette.mid, 1.0, 0.16));
    grad.addColorStop(1, this.silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 18, w, 16);
    // Facet lines catching the mid color.
    ctx.strokeStyle = this.silColor(td.palette.mid, 1.0, 0.28);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 26; k++) {
      let x = rnd() * w, y = 22 + rnd() * 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        x += (rnd() - 0.5) * 90;
        y += (rnd() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ----------------------------------------------------------------
  // Stage 7 theme painters: Worlds 4 to 6, same composited-backdrop
  // contract as batch 1 (dark silhouettes against the baked glow,
  // deterministic per-layer seeds, tiled for the wrap).
  // ----------------------------------------------------------------

  // World 4 far: layered canopy silhouettes overhead with hanging
  // vines (Verdant Canopy sheet). The mass hangs from the top of
  // the frame; a broken tree line closes the bottom.
  private paintCanopyFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(401);
    const fill = this.silColor(td.palette.deep, 0.36);
    ctx.fillStyle = fill;
    this.tiled(ctx, w, () => {
      // Canopy mass: overlapping leaf-clumps hanging from the top.
      let x = -30;
      while (x < w + 30) {
        const rx = 46 + rnd() * 70, ry = rx * (0.42 + rnd() * 0.2);
        const cy = -ry * (0.25 + rnd() * 0.45);
        ctx.beginPath(); ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        x += rx * (0.9 + rnd() * 0.5);
      }
      // Hanging vines: thin curved strands dropping from the mass.
      ctx.strokeStyle = fill; ctx.lineWidth = 3;
      for (let k = 0; k < 9; k++) {
        const vx = rnd() * w, len = h * (0.18 + rnd() * 0.24), sway = (rnd() - 0.5) * 26;
        ctx.beginPath();
        ctx.moveTo(vx, 0);
        ctx.quadraticCurveTo(vx + sway * 0.4, len * 0.55, vx + sway, len);
        ctx.stroke();
        // A leaf pair at the strand's end.
        ctx.beginPath(); ctx.ellipse(vx + sway, len, 7, 3.5, sway * 0.02, 0, Math.PI * 2); ctx.fill();
      }
      // Distant tree line at the base: trunks under a broken crown.
      const base = h * 0.99;
      let tx = 0;
      while (tx < w * 0.8) {
        const tw = 10 + rnd() * 14, th = h * (0.10 + rnd() * 0.12);
        ctx.fillRect(tx, base - th, tw, th);
        ctx.beginPath(); ctx.ellipse(tx + tw / 2, base - th, tw * (1.1 + rnd() * 0.7), h * 0.045, 0, 0, Math.PI * 2); ctx.fill();
        tx += tw + 60 + rnd() * 110;
      }
    });
  }

  // World 4 mid: god-ray shafts from the top glow, then giant leaves
  // drifting past, dark with one bright rim edge (sheet).
  private paintCanopyMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(402);
    this.tiled(ctx, w, () => {
      // God rays: two or three soft wedges widening downward from
      // the top glow. Painted as translucent bright fills over the
      // dark base, so they read as light without additive planes.
      for (let k = 0; k < 3; k++) {
        const sx = w * (0.16 + 0.3 * k) + rnd() * 50, topW = 26 + rnd() * 30, botW = topW * (2.6 + rnd() * 0.8), drift = (rnd() - 0.5) * 60;
        ctx.fillStyle = this.silColor(td.palette.bright, 1.0, 0.075);
        ctx.beginPath();
        ctx.moveTo(sx - topW / 2, 0);
        ctx.lineTo(sx + topW / 2, 0);
        ctx.lineTo(sx + drift + botW / 2, h * 0.86);
        ctx.lineTo(sx + drift - botW / 2, h * 0.86);
        ctx.closePath(); ctx.fill();
      }
      // Giant leaves: a pointed ellipse, near-black green, with the
      // rim light on its upper edge only.
      for (let k = 0; k < 8; k++) {
        const cx = rnd() * w, cy = h * (0.16 + rnd() * 0.62);
        const L = 34 + rnd() * 40, Wd = L * (0.30 + rnd() * 0.1), a = (rnd() - 0.5) * 1.5;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = this.silColor(td.palette.deep, 0.55);
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.quadraticCurveTo(Wd, 0, 0, L); ctx.quadraticCurveTo(-Wd, 0, 0, -L); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = this.silColor(td.palette.bright, 1.0, 0.38); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.quadraticCurveTo(Wd, 0, 0, L); ctx.stroke();
        ctx.restore();
      }
    });
  }

  // World 4 ground: shadowed forest floor with light pools where
  // the shafts land (sheet).
  private paintGroundForest(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(403);
    // Dark floor mass.
    const grad = ctx.createLinearGradient(0, 20, 0, h);
    grad.addColorStop(0, this.silColor(td.palette.deep, 0.30));
    grad.addColorStop(1, this.silColor(td.palette.deep, 0.48));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 20, w, h - 20);
    // Light pools: soft bright ellipses on the floor.
    for (let k = 0; k < 6; k++) {
      const cx = rnd() * w, cy = 44 + rnd() * 56, rx = 30 + rnd() * 46, ry = rx * 0.22;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      g.addColorStop(0, this.silColor(td.palette.bright, 1.0, 0.13));
      g.addColorStop(1, this.silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
      ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
      ctx.restore();
    }
    // Fern silhouettes along the floor line.
    ctx.strokeStyle = this.silColor(td.palette.deep, 0.6); ctx.lineWidth = 2.5;
    for (let k = 0; k < 14; k++) {
      const fx = rnd() * w, fy = 30 + rnd() * 40, s = 8 + rnd() * 12;
      for (let j = -2; j <= 2; j++) {
        ctx.beginPath();
        ctx.moveTo(fx, fy + 14);
        ctx.quadraticCurveTo(fx + j * s * 0.5, fy + 14 - s * 0.8, fx + j * s * 0.8, fy + 14 - s * (1 - Math.abs(j) * 0.18));
        ctx.stroke();
      }
    }
  }

  // World 5 far: jagged peak silhouettes in three gray layers
  // (Ashen Peaks sheet). This is the one desaturated world: the
  // palette is gray at the data level, and the layers separate by
  // value alone.
  private paintAshenFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    // Each ridge is a sum of triangle waves with whole-number
    // periods across the texture width, so the ridge is periodic
    // and the wrap seam is invisible (the lava line's trick, with
    // triangles instead of sines for the jagged profile).
    const tri = (x: number, periods: number, phase: number) => {
      const t = ((x / w) * periods + phase) % 1;
      return Math.abs(t - 0.5) * 2; // 0 at the peak, 1 in the valley
    };
    const layers: Array<{ baseY: number; amp: number; f: number; p1: number; p2: number; ph: number }> = [
      { baseY: 0.60, amp: 0.17, f: 0.62, p1: 5, p2: 9, ph: 0.13 },
      { baseY: 0.74, amp: 0.20, f: 0.74, p1: 7, p2: 12, ph: 0.47 },
      { baseY: 0.88, amp: 0.22, f: 0.86, p1: 6, p2: 11, ph: 0.71 },
    ];
    for (const layer of layers) {
      const yAt = (x: number) => h * (layer.baseY - layer.amp * (1 - (0.6 * tri(x, layer.p1, layer.ph) + 0.4 * tri(x, layer.p2, layer.ph * 1.7))));
      ctx.fillStyle = this.silColor(td.palette.deep, layer.f);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, yAt(0));
      for (let x = 12; x <= w; x += 12) ctx.lineTo(x, yAt(x));
      ctx.lineTo(w, h);
      ctx.closePath(); ctx.fill();
    }
  }

  // World 5 mid: tumbling ash boulders, gray on gray, a dull rim on
  // the upper edge (the Ember boulders' shape language, desaturated).
  private paintAshenMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(504);
    const fill = this.silColor(td.palette.deep, 0.62);
    const rim = this.silColor(td.palette.mid, 1.0, 0.30);
    this.tiled(ctx, w, () => {
      for (let k = 0; k < 11; k++) {
        const cx = rnd() * w, cy = h * (0.14 + rnd() * 0.6);
        const rx = 13 + rnd() * 24, ry = rx * (0.5 + rnd() * 0.25);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      }
    });
  }

  // World 5 ground: a snow-ash ridge line (sheet), pale and still:
  // the ridge gets a dim gray stroke and a faint wash, no pulses.
  private paintGroundAshRidge(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const yAt = (x: number) => 28 + 6 * Math.sin((2 * Math.PI * 2 * x) / w + 0.6) + 3 * Math.sin((2 * Math.PI * 5 * x) / w);
    // Ash mass below the ridge.
    const grad = ctx.createLinearGradient(0, 22, 0, h);
    grad.addColorStop(0, this.silColor(td.palette.deep, 0.30));
    grad.addColorStop(1, this.silColor(td.palette.deep, 0.16));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The ridge line itself: ash-pale, no bloom.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = this.silColor(td.palette.mid, 1.0, 0.55);
    ctx.lineWidth = 3;
    ctx.stroke();
    // Settled drifts piled against the line.
    const rnd = this.themeRng(505);
    ctx.fillStyle = this.silColor(td.palette.mid, 1.0, 0.10);
    for (let k = 0; k < 8; k++) {
      const cx = rnd() * w, cy = yAt(cx) + 8 + rnd() * 22, rx = 22 + rnd() * 34;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // World 6 far: cathedral crystal formations (Crystal Caverns
  // sheet): tall grounded clusters at the base and a hanging vault
  // above, faceted edges catching the world's cyan.
  private paintCavernFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(601);
    const fill = this.silColor(td.palette.deep, 0.40);
    const facet = this.silColor(td.palette.mid, 1.0, 0.35);
    const base = h * 0.99;
    const shard = (cx: number, cy: number, L: number, Wd: number, a: number, flip: boolean) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); if (flip) ctx.scale(1, -1);
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L * 0.28); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = facet; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
      ctx.restore();
    };
    this.tiled(ctx, w, () => {
      // Grounded cathedral clusters.
      for (let c = 0; c < 5; c++) {
        const ccx = rnd() * w;
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const L = h * (0.24 + rnd() * 0.26);
          shard(ccx + (rnd() - 0.5) * 90, base - L * 0.72, L, 13 + rnd() * 15, (rnd() - 0.5) * 0.35, false);
        }
      }
      // The hanging vault: shorter shards pointing down from the top.
      for (let k = 0; k < 6; k++) {
        const L = h * (0.10 + rnd() * 0.13);
        shard(rnd() * w, L * 0.7, L, 9 + rnd() * 10, (rnd() - 0.5) * 0.3, true);
      }
    });
  }

  // World 6 mid: hanging crystal clusters with light shafts falling
  // from them (sheet: shafts from the clusters above; the slow
  // pulse as the player passes is cosmetic and lives in the baked
  // glow, so it costs no per-frame work).
  private paintCavernMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(602);
    const fill = this.silColor(td.palette.deep, 0.58);
    const facet = this.silColor(td.palette.mid, 1.0, 0.30);
    this.tiled(ctx, w, () => {
      for (let c = 0; c < 6; c++) {
        const ccx = rnd() * w;
        // The shaft under this cluster.
        const shaftW = 30 + rnd() * 36;
        ctx.fillStyle = this.silColor(td.palette.bright, 1.0, 0.055);
        ctx.beginPath();
        ctx.moveTo(ccx - shaftW * 0.3, 0);
        ctx.lineTo(ccx + shaftW * 0.3, 0);
        ctx.lineTo(ccx + shaftW * 0.75, h * 0.8);
        ctx.lineTo(ccx - shaftW * 0.75, h * 0.8);
        ctx.closePath(); ctx.fill();
        // The cluster itself: a fan of downward shards.
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const cx = ccx + (rnd() - 0.5) * 56, L = 20 + rnd() * 30, Wd = 6 + rnd() * 7, a = (rnd() - 0.5) * 0.5;
          ctx.save(); ctx.translate(cx, L * 0.55); ctx.rotate(a); ctx.scale(1, -1);
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L * 0.3); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = facet; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
          ctx.restore();
        }
      }
    });
  }

  // World 6 ground: a reflective crystal floor (sheet): a bright
  // horizon streak, facet lines, and dim mirrored glows below it.
  private paintGroundCrystal(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(603);
    ctx.fillStyle = this.silColor(td.palette.deep, 0.34);
    ctx.fillRect(0, 18, w, h - 18);
    // Horizon streak: the floor reflecting the top glow.
    const grad = ctx.createLinearGradient(0, 18, 0, 40);
    grad.addColorStop(0, this.silColor(td.palette.mid, 1.0, 0.20));
    grad.addColorStop(1, this.silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 18, w, 22);
    // Mirrored glow pools, dimmer than any real light.
    for (let k = 0; k < 5; k++) {
      const cx = rnd() * w, cy = 52 + rnd() * 52, rx = 26 + rnd() * 40;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      g.addColorStop(0, this.silColor(td.palette.bright, 1.0, 0.08));
      g.addColorStop(1, this.silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
    }
    // Facet lines.
    ctx.strokeStyle = this.silColor(td.palette.mid, 1.0, 0.30);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 22; k++) {
      let x = rnd() * w, y = 24 + rnd() * 64;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        x += (rnd() - 0.5) * 100;
        y += (rnd() - 0.5) * 22;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ----------------------------------------------------------------
  // Stage 8 theme painters: Worlds 7 to 10, same composited-
  // backdrop contract as batches 1 and 2 (dark silhouettes against
  // the baked glow, deterministic per-layer seeds, tiled for the
  // wrap). The two set pieces that cannot live in a static bake,
  // Blood Moon's waxing moon and the Rift's pulsing seam, are
  // separate small meshes managed in applyThemeScene.
  // ----------------------------------------------------------------

  // World 7 far: the aurora curtain across the top third (two
  // wavy ribbons, magenta and teal, baked soft over the sky
  // glows), nebula cloud silhouettes, and a ringed planet.
  private paintNebulaFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(701);
    // Aurora ribbons: horizontal bands with a sine top edge and
    // a long vertical fade, so the curtain hangs and dissolves.
    const ribbon = (baseY: number, amp: number, periods: number, phase: number, rgb: Rgb3, alpha: number) => {
      const grad = ctx.createLinearGradient(0, baseY - 26, 0, baseY + h * 0.30);
      grad.addColorStop(0, this.silColor(rgb, 1.0, 0));
      grad.addColorStop(0.35, this.silColor(rgb, 1.0, alpha));
      grad.addColorStop(1, this.silColor(rgb, 1.0, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, baseY + h * 0.30);
      ctx.lineTo(0, baseY + amp * Math.sin(phase));
      for (let x = 16; x <= w; x += 16) ctx.lineTo(x, baseY + amp * Math.sin((2 * Math.PI * periods * x) / w + phase));
      ctx.lineTo(w, baseY + h * 0.30);
      ctx.closePath(); ctx.fill();
    };
    ribbon(h * 0.06, 13, 2, 0.7, td.sky.secondaryGlow ?? [0.0, 0.9, 0.8], 0.16); // teal curtain
    ribbon(h * 0.16, 17, 3, 2.4, td.palette.bright, 0.13); // magenta curtain behind it
    this.tiled(ctx, w, () => {
      // Nebula clouds: clusters of soft dark ellipses with a
      // faint magenta rim on the lit side.
      for (let c = 0; c < 6; c++) {
        const ccx = rnd() * w, ccy = h * (0.30 + rnd() * 0.5);
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const cx = ccx + (rnd() - 0.5) * 120, cy = ccy + (rnd() - 0.5) * 42;
          const rx = 34 + rnd() * 62, ry = rx * (0.30 + rnd() * 0.16);
          ctx.fillStyle = this.silColor(td.palette.deep, 0.42);
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = this.silColor(td.palette.mid, 1.0, 0.16);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.15, Math.PI * 1.75); ctx.stroke();
        }
      }
      // The ringed planet, high right: a dark disc with a pale
      // ice rim, crossed by its ring.
      const px = w * 0.78, py = h * 0.20, pr = 34;
      ctx.fillStyle = this.silColor(td.palette.deep, 0.60);
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = this.silColor([0.90, 0.97, 1.0], 1.0, 0.30);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, pr, Math.PI * 1.05, Math.PI * 1.65); ctx.stroke();
      ctx.strokeStyle = this.silColor([0.90, 0.97, 1.0], 1.0, 0.22);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(px, py, pr * 1.9, pr * 0.42, -0.32, 0, Math.PI * 2); ctx.stroke();
    });
  }

  // World 7 mid: ice asteroids, faceted and tumbling: angular
  // shards of dark magenta rock with ice-white facet lines.
  private paintNebulaMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(702);
    const fill = this.silColor(td.palette.deep, 0.58);
    const facet = this.silColor([0.90, 0.97, 1.0], 1.0, 0.30);
    this.tiled(ctx, w, () => {
      for (let k = 0; k < 12; k++) {
        const cx = rnd() * w, cy = h * (0.12 + rnd() * 0.66);
        const R = 12 + rnd() * 26, rot = rnd() * Math.PI * 2;
        const verts = 5 + Math.floor(rnd() * 3);
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let vIdx = 0; vIdx < verts; vIdx++) {
          const a = rot + (vIdx / verts) * Math.PI * 2;
          const rr = R * (0.62 + rnd() * 0.5);
          const vx = cx + Math.cos(a) * rr, vy = cy + Math.sin(a) * rr * 0.78;
          if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath(); ctx.fill();
        // One or two facet lines from the center of the rock.
        ctx.strokeStyle = facet; ctx.lineWidth = 1.5;
        for (let f = 0; f < 2; f++) {
          const a = rot + rnd() * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.62);
          ctx.stroke();
        }
      }
    });
  }

  // World 7 ground: an ice plain horizon with the aurora
  // reflected in it: a two-tone streak (magenta, then teal),
  // crack lines in pale ice, and dim mirrored glow pools.
  private paintGroundIce(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(703);
    ctx.fillStyle = this.silColor(td.palette.deep, 0.34);
    ctx.fillRect(0, 18, w, h - 18);
    // The aurora reflection: magenta wash on the left reach of
    // the strip, teal on the right, both fading down.
    const gradM = ctx.createLinearGradient(0, 18, 0, 44);
    gradM.addColorStop(0, this.silColor(td.palette.mid, 1.0, 0.15));
    gradM.addColorStop(1, this.silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = gradM;
    ctx.fillRect(0, 18, w * 0.55, 26);
    const teal = td.sky.secondaryGlow ?? [0.0, 0.9, 0.8];
    const gradT = ctx.createLinearGradient(0, 18, 0, 44);
    gradT.addColorStop(0, this.silColor(teal, 1.0, 0.13));
    gradT.addColorStop(1, this.silColor(teal, 1.0, 0));
    ctx.fillStyle = gradT;
    ctx.fillRect(w * 0.45, 18, w * 0.55, 26);
    // Mirrored glow pools.
    for (let k = 0; k < 5; k++) {
      const cx = rnd() * w, cy = 52 + rnd() * 52, rx = 26 + rnd() * 40;
      const rgb = k % 2 === 0 ? td.palette.bright : teal;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      g.addColorStop(0, this.silColor(rgb, 1.0, 0.07));
      g.addColorStop(1, this.silColor(rgb, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
    }
    // Ice cracks: pale thin fractures.
    ctx.strokeStyle = this.silColor([0.90, 0.97, 1.0], 1.0, 0.26);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 22; k++) {
      let x = rnd() * w, y = 24 + rnd() * 64;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        x += (rnd() - 0.5) * 110;
        y += (rnd() - 0.5) * 18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // World 8 far: dunes in smooth layered ridges, obelisks, and
  // the broken colossus (Golden Sands sheet), all matte silhou-
  // ette against the corner sun's haze.
  private paintSandsFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(801);
    // Two dune ridges behind everything: sine sums with whole-
    // number periods so the wrap seam is invisible (the Ashen
    // ridge trick, smoothed for sand).
    const dune = (baseY: number, amp: number, f: number, p1: number, p2: number, ph: number) => {
      const yAt = (x: number) => h * baseY + h * amp * (0.6 * Math.sin((2 * Math.PI * p1 * x) / w + ph) + 0.4 * Math.sin((2 * Math.PI * p2 * x) / w + ph * 1.7));
      ctx.fillStyle = this.silColor(td.palette.deep, f);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, yAt(0));
      for (let x = 12; x <= w; x += 12) ctx.lineTo(x, yAt(x));
      ctx.lineTo(w, h);
      ctx.closePath(); ctx.fill();
    };
    dune(0.66, 0.05, 0.42, 2, 5, 0.4);
    dune(0.80, 0.06, 0.58, 3, 7, 1.9);
    const fill = this.silColor(td.palette.deep, 0.66);
    const rim = this.silColor(td.palette.mid, 1.0, 0.22);
    this.tiled(ctx, w, () => {
      // Obelisks: tapered pillars with a pyramidion cap, some
      // standing on the far dune line, one snapped short.
      for (let k = 0; k < 4; k++) {
        const ox = rnd() * w, ow = 13 + rnd() * 10, oh = h * (0.20 + rnd() * 0.16), oy = h * 0.86;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(ox - ow * 0.62, oy);
        ctx.lineTo(ox - ow * 0.40, oy - oh);
        ctx.lineTo(ox + ow * 0.40, oy - oh);
        ctx.lineTo(ox + ow * 0.62, oy);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(ox - ow * 0.52, oy - oh);
        ctx.lineTo(ox, oy - oh - ow * 0.72);
        ctx.lineTo(ox + ow * 0.52, oy - oh);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ox - ow * 0.40, oy - oh); ctx.lineTo(ox - ow * 0.62, oy); ctx.stroke();
      }
      // The broken colossus: a colossal head in profile, cracked
      // at the crown, with its fallen forearm beside it.
      const hx = w * 0.66, hy = h * 0.86, hs = h * 0.30;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(hx - hs * 0.52, hy);
      ctx.lineTo(hx - hs * 0.55, hy - hs * 0.52); // jaw and face front
      ctx.lineTo(hx - hs * 0.30, hy - hs * 0.60);
      ctx.lineTo(hx - hs * 0.34, hy - hs * 0.88); // brow
      ctx.lineTo(hx - hs * 0.05, hy - hs * 0.80); // the crack: crown dips
      ctx.lineTo(hx + hs * 0.10, hy - hs * 0.97); // crown peak
      ctx.lineTo(hx + hs * 0.48, hy - hs * 0.90);
      ctx.lineTo(hx + hs * 0.55, hy - hs * 0.40);
      ctx.lineTo(hx + hs * 0.50, hy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = this.silColor(td.palette.deep, 0.30); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx - hs * 0.05, hy - hs * 0.80); ctx.lineTo(hx + hs * 0.16, hy - hs * 0.45); ctx.stroke();
      ctx.fillStyle = this.silColor(td.palette.deep, 0.24);
      ctx.fillRect(hx - hs * 0.44, hy - hs * 0.44, hs * 0.30, hs * 0.07); // the eye slit, unlit
      const fx = hx + hs * 0.95, fy = hy - hs * 0.10;
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.ellipse(fx, fy, hs * 0.42, hs * 0.13, -0.18, 0, Math.PI * 2); ctx.fill(); // fallen forearm
      for (let fg = 0; fg < 3; fg++) { // three finger blocks
        ctx.fillRect(fx + hs * (0.28 + fg * 0.14), fy - hs * 0.16 - fg * hs * 0.02, hs * 0.09, hs * 0.14);
      }
    });
  }

  // World 8 mid: wind-blown sand sheets (wide, faint, fast in
  // feel: long horizontal streaks) and tumbling shards of
  // pottery-bright stone.
  private paintSandsMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(802);
    this.tiled(ctx, w, () => {
      // Sand sheets: very flat ellipses at low alpha, in the
      // palette's bright band so they read as lit dust, not fog.
      for (let k = 0; k < 9; k++) {
        const cx = rnd() * w, cy = h * (0.10 + rnd() * 0.72);
        const rx = 90 + rnd() * 170, ry = 3 + rnd() * 6;
        ctx.fillStyle = this.silColor(td.palette.bright, 1.0, 0.05 + rnd() * 0.04);
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      }
      // Pottery shards: small angular pieces with one lit edge.
      for (let k = 0; k < 13; k++) {
        const cx = rnd() * w, cy = h * (0.12 + rnd() * 0.66);
        const R = 7 + rnd() * 13, rot = rnd() * Math.PI * 2;
        ctx.fillStyle = this.silColor(td.palette.deep, 0.62);
        ctx.beginPath();
        for (let vIdx = 0; vIdx < 4; vIdx++) {
          const a = rot + (vIdx / 4) * Math.PI * 2;
          const rr = R * (0.6 + rnd() * 0.55);
          const vx = cx + Math.cos(a) * rr, vy = cy + Math.sin(a) * rr * 0.8;
          if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = this.silColor(td.palette.mid, 1.0, 0.30);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - R * 0.6, cy - R * 0.3); ctx.lineTo(cx + R * 0.4, cy - R * 0.55); ctx.stroke();
      }
    });
  }

  // World 8 ground: a dune ridge line with ruins half-buried:
  // block tops and a broken column shoulder out of the sand
  // along the line.
  private paintGroundDune(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(803);
    const yAt = (x: number) => 30 + 6 * Math.sin((2 * Math.PI * 3 * x) / w + 0.8) + 3 * Math.sin((2 * Math.PI * 8 * x) / w);
    // Warm haze wash above the line.
    const grad = ctx.createLinearGradient(0, 8, 0, 34);
    grad.addColorStop(0, this.silColor(td.palette.mid, 1.0, 0.10));
    grad.addColorStop(1, this.silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 8, w, 26);
    // Sand mass below the line.
    const grad2 = ctx.createLinearGradient(0, 26, 0, h);
    grad2.addColorStop(0, this.silColor(td.palette.deep, 0.34));
    grad2.addColorStop(1, this.silColor(td.palette.deep, 0.20));
    ctx.fillStyle = grad2;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The ridge line itself, sunlit.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = this.silColor(td.palette.mid, 1.0, 0.6);
    ctx.lineWidth = 3;
    ctx.stroke();
    // Half-buried ruins: block tops and one broken column,
    // sunk into the ridge at their bases.
    ctx.fillStyle = this.silColor(td.palette.deep, 0.55);
    for (let k = 0; k < 6; k++) {
      const bx = rnd() * w, bw = 22 + rnd() * 34, bh = 8 + rnd() * 12;
      ctx.fillRect(bx, yAt(bx) - bh + 4, bw, bh);
    }
    const cx0 = rnd() * w;
    ctx.fillRect(cx0, yAt(cx0) - 26, 11, 30);
    ctx.fillRect(cx0 - 3, yAt(cx0) - 30, 17, 6); // capital fragment
  }

  // World 9 far: gothic spires and dead trees (Blood Moon
  // sheet). The moon itself is not painted here: it waxes with
  // run progress, so it lives on its own mesh (applyThemeScene).
  private paintBloodFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(901);
    const fill = this.silColor(td.palette.deep, 0.52);
    const base = h * 0.99;
    this.tiled(ctx, w, () => {
      // Gothic spires: thin towers with a pointed cap and a
      // crossbar or two, rooted at the base line.
      for (let k = 0; k < 6; k++) {
        const sx = rnd() * w, sw = 9 + rnd() * 13, sh = h * (0.24 + rnd() * 0.30);
        ctx.fillStyle = fill;
        ctx.fillRect(sx - sw / 2, base - sh, sw, sh);
        ctx.beginPath();
        ctx.moveTo(sx - sw * 0.72, base - sh);
        ctx.lineTo(sx, base - sh - sw * 1.5);
        ctx.lineTo(sx + sw * 0.72, base - sh);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(sx - sw * 0.95, base - sh * (0.45 + rnd() * 0.2), sw * 1.9, 3.5); // crossbar
      }
      // Dead trees: a tapering trunk and bare recursive-looking
      // branches, drawn as tapering strokes.
      const branch = (x: number, y: number, ang: number, len: number, wd: number, depth: number) => {
        const ex = x + Math.cos(ang) * len, ey = y - Math.sin(ang) * len;
        ctx.strokeStyle = fill; ctx.lineWidth = wd;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        if (depth <= 0) return;
        branch(ex, ey, ang + 0.38 + rnd() * 0.25, len * 0.68, wd * 0.62, depth - 1);
        branch(ex, ey, ang - 0.34 - rnd() * 0.25, len * 0.64, wd * 0.62, depth - 1);
        if (rnd() < 0.5) branch(ex, ey, ang + (rnd() - 0.5) * 0.2, len * 0.5, wd * 0.5, depth - 1);
      };
      for (let k = 0; k < 4; k++) {
        branch(rnd() * w, base, Math.PI / 2 + (rnd() - 0.5) * 0.14, h * (0.15 + rnd() * 0.07), 7, 3);
      }
    });
  }

  // World 9 mid: floating rock shards and bone-like shards,
  // moonlit on one edge.
  private paintBloodMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(902);
    const fill = this.silColor(td.palette.deep, 0.62);
    const rim = this.silColor(td.palette.mid, 1.0, 0.28);
    this.tiled(ctx, w, () => {
      for (let k = 0; k < 10; k++) {
        const cx = rnd() * w, cy = h * (0.14 + rnd() * 0.6);
        const R = 10 + rnd() * 22, rot = rnd() * Math.PI * 2;
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let vIdx = 0; vIdx < 5; vIdx++) {
          const a = rot + (vIdx / 5) * Math.PI * 2;
          const rr = R * (0.6 + rnd() * 0.55);
          const vx = cx + Math.cos(a) * rr, vy = cy + Math.sin(a) * rr * 0.8;
          if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - R * 0.55, cy - R * 0.35); ctx.lineTo(cx + R * 0.3, cy - R * 0.6); ctx.stroke();
      }
      // Bone shards: pale elongated capsules with knob ends,
      // dimmer than any pickup, unmistakably debris. Kept small
      // and dim: a first cut at stage size read as a bright
      // gray chain across the menu (Stage 8 screenshot review).
      for (let k = 0; k < 5; k++) {
        const cx = rnd() * w, cy = h * (0.2 + rnd() * 0.55);
        const len = 9 + rnd() * 13, ang = rnd() * Math.PI;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        ctx.strokeStyle = this.silColor([0.72, 0.60, 0.52], 1.0, 0.19);
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx - dx * len / 2, cy - dy * len / 2); ctx.lineTo(cx + dx * len / 2, cy + dy * len / 2); ctx.stroke();
        ctx.fillStyle = this.silColor([0.72, 0.60, 0.52], 1.0, 0.19);
        for (const sgn of [-1, 1]) {
          ctx.beginPath(); ctx.arc(cx + dx * len / 2 * sgn, cy + dy * len / 2 * sgn, 2.9, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
  }

  // World 9 ground: a dark ridge with the moon's reflection in
  // a thin red line along its crest.
  private paintGroundBloodRidge(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const yAt = (x: number) => 30 + 5 * Math.sin((2 * Math.PI * 2 * x) / w + 2.1) + 4 * Math.sin((2 * Math.PI * 6 * x) / w + 0.4);
    // Ridge mass: the darkest ground in the game so far.
    const grad = ctx.createLinearGradient(0, 24, 0, h);
    grad.addColorStop(0, this.silColor(td.palette.deep, 0.50));
    grad.addColorStop(1, this.silColor(td.palette.deep, 0.34));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The moon's reflection: a thin red line riding the crest.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = this.silColor(td.palette.bright, 1.0, 0.55);
    ctx.lineWidth = 2;
    ctx.shadowColor = this.silColor(td.palette.bright, 1.0, 0.7);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // World 10 far: broken world shards, one silhouette motif
  // from each of the nine worlds before it (Abyssal Rift
  // sheet), drifting in the black. The palette's deep band is
  // true black, so the shards are drawn in the mid violet
  // darkened, with a bright edge catching the rift light on a
  // few of them.
  private paintRiftFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const fill = this.silColor(td.palette.mid, 0.60);
    const edge = this.silColor(td.palette.bright, 1.0, 0.35);
    // Nine motifs on a loose scatter, each a simplified glyph
    // of its world's far layer. Drawn once across the tile;
    // the tiled() wrap keeps the field continuous.
    const motifs: Array<[number, number, number, (x: number, y: number, s: number) => void]> = [
      [0.06, 0.62, 46, (x, y, s) => { // basalt spire (World 1)
        ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s); ctx.lineTo(x - s * 0.1, y - s * 0.6); ctx.lineTo(x + s * 0.12, y - s); ctx.lineTo(x + s * 0.3, y - s * 0.55); ctx.lineTo(x + s * 0.34, y + s); ctx.closePath(); ctx.fill();
      }],
      [0.17, 0.34, 40, (x, y, s) => { // sunken pillar (World 2)
        ctx.fillRect(x - s * 0.16, y - s, s * 0.32, s * 2);
        ctx.fillRect(x - s * 0.3, y - s, s * 0.6, s * 0.18);
        ctx.fillRect(x - s * 0.3, y + s * 0.82, s * 0.6, s * 0.18);
      }],
      [0.28, 0.70, 42, (x, y, s) => { // crystal shard (World 3)
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.34, y); ctx.lineTo(x, y + s * 0.4); ctx.lineTo(x - s * 0.34, y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.34, y); ctx.stroke();
      }],
      [0.39, 0.28, 36, (x, y, s) => { // leaf (World 4)
        ctx.beginPath(); ctx.ellipse(x, y, s * 0.36, s * 0.85, 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s * 0.7); ctx.lineTo(x + s * 0.3, y - s * 0.7); ctx.stroke();
      }],
      [0.50, 0.58, 48, (x, y, s) => { // peak (World 5)
        ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.7); ctx.lineTo(x - s * 0.2, y - s * 0.5); ctx.lineTo(x + s * 0.15, y - s * 0.1); ctx.lineTo(x + s * 0.45, y - s * 0.75); ctx.lineTo(x + s, y + s * 0.7); ctx.closePath(); ctx.fill();
      }],
      [0.61, 0.32, 44, (x, y, s) => { // cathedral shard (World 6)
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.26, y + s * 0.3); ctx.lineTo(x, y + s * 0.55); ctx.lineTo(x - s * 0.26, y + s * 0.3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.55); ctx.lineTo(x - s * 0.36, y - s * 0.3); ctx.lineTo(x - s * 0.2, y + s * 0.55); ctx.closePath(); ctx.fill();
      }],
      [0.72, 0.66, 38, (x, y, s) => { // ringed planet fragment (World 7)
        ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, s * 1.05, s * 0.24, -0.32, 0, Math.PI * 2); ctx.stroke();
      }],
      [0.83, 0.36, 42, (x, y, s) => { // obelisk (World 8)
        ctx.beginPath(); ctx.moveTo(x - s * 0.2, y + s); ctx.lineTo(x - s * 0.13, y - s * 0.7); ctx.lineTo(x, y - s); ctx.lineTo(x + s * 0.13, y - s * 0.7); ctx.lineTo(x + s * 0.2, y + s); ctx.closePath(); ctx.fill();
      }],
      [0.93, 0.60, 40, (x, y, s) => { // dead tree (World 9)
        ctx.strokeStyle = fill; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x + s * 0.06, y - s * 0.5); ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + s * 0.06, y - s * 0.5); ctx.lineTo(x - s * 0.4, y - s * 0.85); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + s * 0.06, y - s * 0.5); ctx.lineTo(x + s * 0.45, y - s * 0.95); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + s * 0.02, y - s * 0.15); ctx.lineTo(x + s * 0.5, y - s * 0.4); ctx.stroke();
      }],
    ];
    this.tiled(ctx, w, () => {
      for (const [fx, fy, s, draw] of motifs) {
        ctx.fillStyle = fill;
        draw(fx * w, fy * h, s);
      }
    });
  }

  // World 10 mid: rift shards of black glass with bright edges:
  // near-black violet polygons, one edge each lit star white.
  private paintRiftMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = this.themeRng(1002);
    const fill = this.silColor(td.palette.mid, 0.34);
    const edge = this.silColor(td.palette.bright, 1.0, 0.55);
    this.tiled(ctx, w, () => {
      for (let k = 0; k < 13; k++) {
        const cx = rnd() * w, cy = h * (0.10 + rnd() * 0.72);
        const R = 10 + rnd() * 24, rot = rnd() * Math.PI * 2;
        const verts = 4 + Math.floor(rnd() * 3);
        const pts: Array<[number, number]> = [];
        for (let vIdx = 0; vIdx < verts; vIdx++) {
          const a = rot + (vIdx / verts) * Math.PI * 2;
          const rr = R * (0.6 + rnd() * 0.55);
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82]);
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        pts.forEach(([vx, vy], idx) => { if (idx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy); });
        ctx.closePath(); ctx.fill();
        // The bright edge: the shard's longest upper edge.
        ctx.strokeStyle = edge; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
      }
    });
  }

  // World 10 ground: none (World 10 sheet). The horizon band
  // is removed for the only time in the game; the player flies
  // over open void with the rift's glow below. The absence is
  // the theme, so this painter paints nothing.
  private paintGroundNone(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    // Intentionally empty: no ground strip for the Abyssal Rift.
  }

  private onMouseMove(event: MouseEvent) {
    if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen()) return;
    this.updateMouseTarget(event.clientX, event.clientY, false);
  }

  private onTouchMove(event: TouchEvent) {
    if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen()) return;
    if (event.touches.length > 0) {
      // Prevent the WebView from scrolling / rubber-banding while the finger drives the Phoenix,
      // but only during gameplay so menu UI (buttons, scroll) still works.
      if (this.gameState.activeScreen() === 'game' && event.cancelable) event.preventDefault();
      this.updateMouseTarget(event.touches[0].clientX, event.touches[0].clientY, true);
    }
  }

  private updateMouseTarget(x: number, y: number, isTouch: boolean) {
    // Touch finger offset (spec Section 2.1): the steering target is
    // lifted above the fingertip on the game screen when the setting
    // is on; mouse input is never offset.
    const adjusted = this.gameState.applyTouchOffset(x, y, isTouch);
    x = adjusted.x;
    y = adjusted.y;
    const vec = new THREE.Vector3();
    const pos = new THREE.Vector3();
    vec.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5);
    vec.unproject(this.camera);
    vec.sub(this.camera.position).normalize();
    const distance = (-15 - this.camera.position.z) / vec.z;
    pos.copy(this.camera.position).add(vec.multiplyScalar(distance));
    this.mouseTarget.copy(pos);
  }

  private createBirdState(theme: string): PhoenixState {
    return {
      theme, group: new THREE.Group(), particles: new THREE.Points(), fillParticles: null, core: null, glow: null, basePositions: new Float32Array(0),
      inFill: new Uint8Array(0), bufferIndex: new Uint16Array(0), pointRegion: new Uint8Array(0), sparkle: new Uint8Array(0), ashVec: new Float32Array(0),
      skinId: 'ember', flapRate: 1, climbTime: 0, spoolT: -1, wasDashing: false, wasDrilling: false, wasRushing: false, flashUntil: 0, reformUntil: 0, glowSpanFactor: 1.35,
      phoenixCount: 4000, currentBank: 0, flapTime: 0, position: new THREE.Vector3(0, -5, -15),
      velocity: new THREE.Vector3(0, 1, 0), previousVelocity: new THREE.Vector3(0, 1, 0),
      targetWaypoint: new THREE.Vector3(), historyPos: [], historyQuat: []
    };
  }

  // Bird cruise speed in world units per second at speed multiplier 1:
  // the visible width at the flight plane divided by the canonical
  // crossing time.
  private nominalBirdSpeed(): number {
    return (this.boundX * 2) / ParticleBgComponent.BIRD_CROSSING_SECONDS;
  }

  private createGlowTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  // Color of one bird point under a skin: three distance bands from the
  // point's BASE position (stable, unlike the old code, which banded by
  // the live world position and so re-banded as the bird moved), then
  // the skin's trail styling on the tail and fringe points.
  private colorForPoint(bird: PhoenixState, skin: PhoenixSkin, k: number): Rgb3 {
    const idx = k * 3;
    const bx = bird.basePositions[idx];
    const bz = bird.basePositions[idx + 2];
    const dist = Math.sqrt(bx * bx + bz * bz);
    let c: Rgb3 = (dist < 0.8 && bz < 0.8) ? skin.bright : (dist < 2.0 && bz < 2.4) ? skin.mid : skin.deep;
    const region = bird.pointRegion[k];
    if (region === 2) {
      // Outer fringe: dimmer deep-mid mix, except Eclipse, whose fringe
      // is the bright violet spark edge around the dark body.
      c = skin.trailStyle === 'eclipse' ? skin.bright
        : [skin.deep[0] + (skin.mid[0] - skin.deep[0]) * 0.35, skin.deep[1] + (skin.mid[1] - skin.deep[1]) * 0.35, skin.deep[2] + (skin.mid[2] - skin.deep[2]) * 0.35];
    }
    if (bz > 7.2) {
      // Tail and trail region: the last stretch of the ribbon.
      const t = Math.min(1, (bz - 7.2) / 2.8);
      if (skin.trailStyle === 'snow') {
        c = [c[0] + (skin.bright[0] - c[0]) * 0.65, c[1] + (skin.bright[1] - c[1]) * 0.65, c[2] + (skin.bright[2] - c[2]) * 0.65];
      } else if (skin.trailStyle === 'eclipse') {
        c = k % 3 === 0 ? skin.bright : [skin.deep[0] * 0.45, skin.deep[1] * 0.45, skin.deep[2] * 0.45];
      } else if (skin.trailStyle === 'sequence' && skin.trailA && skin.trailB) {
        c = k % 2 === 0 ? skin.trailA : skin.trailB;
      } else if (skin.trailStyle === 'pollen') {
        const m = k % 5 === 0 ? 0.8 : 0.25;
        c = [c[0] + (skin.bright[0] - c[0]) * m, c[1] + (skin.bright[1] - c[1]) * m, c[2] + (skin.bright[2] - c[2]) * m];
      } else if (skin.trailStyle === 'ribbon') {
        c = [skin.mid[0] + (skin.bright[0] - skin.mid[0]) * t, skin.mid[1] + (skin.bright[1] - skin.mid[1]) * t, skin.mid[2] + (skin.bright[2] - skin.mid[2]) * t];
      }
    }
    return c;
  }

  private applyBirdColors(bird: PhoenixState, skin: PhoenixSkin) {
    if (!bird || !bird.particles || !bird.inFill || bird.inFill.length === 0) return;
    const mainCol = bird.particles.geometry.attributes['color'].array as Float32Array;
    const fillCol = bird.fillParticles ? (bird.fillParticles.geometry.attributes['color'].array as Float32Array) : null;
    for (let k = 0; k < bird.phoenixCount; k++) {
      const c = this.colorForPoint(bird, skin, k);
      const arr = bird.inFill[k] ? fillCol : mainCol;
      if (!arr) continue;
      const j = bird.bufferIndex[k] * 3;
      arr[j] = c[0]; arr[j + 1] = c[1]; arr[j + 2] = c[2];
    }
    bird.particles.geometry.attributes['color'].needsUpdate = true;
    if (bird.fillParticles) bird.fillParticles.geometry.attributes['color'].needsUpdate = true;
  }

  // One point's current display color, across the two buffers. Used by
  // the turret construction, which copies the player bird's colors.
  private birdColorAt(bird: PhoenixState, k: number): Rgb3 {
    const attr = bird.inFill[k] ? bird.fillParticles?.geometry.attributes['color'] : bird.particles.geometry.attributes['color'];
    const arr = attr?.array as Float32Array | undefined;
    if (!arr) return [1, 1, 1];
    const j = bird.bufferIndex[k] * 3;
    return [arr[j] || 0, arr[j + 1] || 0, arr[j + 2] || 0];
  }

  private applySkin(skin: PhoenixSkin) {
    const bird = this.bird;
    if (!bird || !bird.particles) return;
    bird.skinId = skin.id;
    bird.glowSpanFactor = skin.glowSpan;
    this.applyBirdColors(bird, skin);
    if (bird.core) {
      (bird.core.material as THREE.MeshBasicMaterial).map = this.glyphTexture(skin);
      (bird.core.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
    if (bird.glow) {
      const gm = bird.glow.material as THREE.SpriteMaterial;
      gm.color.setRGB(skin.bright[0], skin.bright[1], skin.bright[2]);
      const tex = skin.glowRing === 'eclipse' ? this.createRingGlowTexture()
        : skin.glowRing === 'halo' ? this.createHaloGlowTexture()
        : this.glowTexture;
      if (tex && gm.map !== tex) { gm.map = tex; gm.needsUpdate = true; }
    }
    // World colors re-run so the ambient hue-collision shift follows
    // the newly equipped skin.
    const theme = WORLDS[this.gameState.selectedWorldIndex()].theme;
    this.updateColors(theme);
  }

  private createRingGlowTexture(): THREE.Texture {
    if (this.ringGlowTexture) return this.ringGlowTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // Eclipse glow: a dark centre falloff with a bright ring (spec 2.4).
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    this.ringGlowTexture = new THREE.CanvasTexture(canvas);
    return this.ringGlowTexture;
  }

  private createHaloGlowTexture(): THREE.Texture {
    if (this.haloGlowTexture) return this.haloGlowTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // Celestial glow: the soft round 1 glow plus a faint outer halo ring.
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.82, 'rgba(255,255,255,0.30)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    this.haloGlowTexture = new THREE.CanvasTexture(canvas);
    return this.haloGlowTexture;
  }

  // The silhouette glyph (spec Section 2.1): one canvas-drawn phoenix
  // silhouette per skin, cached. Drawn from the same normalized outline
  // as the particle fill, in the skin's palette with a bright core
  // gradient; the skin's edge treatment (angular, serrated, crest,
  // dark heart, facets, sparkles) is applied here, inside the same
  // bounding box for every skin. The canvas is 256 by 320, matching
  // the core plane's 1 by 1.25 aspect, so a normalized unit covers the
  // same pixels on both axes and the drawn glyph lands exactly on the
  // sampled fill. The beak gets an explicit bright wedge and the head
  // a pair of eyes on top of the fill, so the front of the bird reads
  // as a head even where path smoothing rounds the outline's beak
  // spike (addendum: the bird must read as an actual phoenix).
  private glyphTexture(skin: PhoenixSkin): THREE.Texture {
    const cached = this.glyphTextures.get(skin.id);
    if (cached) return cached;
    const S = 256;
    const H = 320;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const px = (nx: number) => S / 2 + nx * (S * 0.46);
    const py = (nz: number) => 10 + nz * (H - 20);
    // Canvas-space outline; broad-winged skins (Solar) drop the wingtip
    // line lower inside the same box.
    const outline = GLYPH_OUTLINE.map(([nx, nz]): [number, number] => {
      let x = nx, z = nz;
      if (skin.glyph.broadWings && Math.abs(nx) > 0.55 && nz > 0.1 && nz < 0.5) z += 0.05 * Math.sin(((Math.abs(nx) - 0.55) / 0.45) * Math.PI);
      if (skin.glyph.serrated && nz > 0.3 && nz < 0.5 && Math.abs(nx) > 0.3) z += (Math.round(Math.abs(nx) * 10) % 2 === 0 ? 0.018 : -0.018);
      return [px(x), py(z)];
    });
    const path = new Path2D();
    if (skin.glyph.angular) {
      outline.forEach(([x, y], i) => { if (i === 0) path.moveTo(x, y); else path.lineTo(x, y); });
      path.closePath();
    } else {
      // Smooth curve through the outline points (midpoint quadratics).
      const n = outline.length;
      path.moveTo((outline[0][0] + outline[n - 1][0]) / 2, (outline[0][1] + outline[n - 1][1]) / 2);
      for (let i = 0; i < n; i++) {
        const [x, y] = outline[i];
        const [mx, my] = outline[(i + 1) % n];
        path.quadraticCurveTo(x, y, (x + mx) / 2, (y + my) / 2);
      }
      path.closePath();
    }
    // Mid-dominant fill with a bright core (spec 2.1): the deep band is
    // only the rim, so the silhouette never reads dark against the sky.
    const grad = ctx.createRadialGradient(S / 2, py(0.30), 6, S / 2, py(0.36), H * 0.52);
    grad.addColorStop(0, `rgb(${Math.round(skin.bright[0] * 255)},${Math.round(skin.bright[1] * 255)},${Math.round(skin.bright[2] * 255)})`);
    grad.addColorStop(0.38, `rgb(${Math.round(skin.mid[0] * 255)},${Math.round(skin.mid[1] * 255)},${Math.round(skin.mid[2] * 255)})`);
    grad.addColorStop(1, `rgb(${Math.round(skin.deep[0] * 255)},${Math.round(skin.deep[1] * 255)},${Math.round(skin.deep[2] * 255)})`);
    ctx.save();
    ctx.shadowColor = `rgba(${Math.round(skin.mid[0] * 255)},${Math.round(skin.mid[1] * 255)},${Math.round(skin.mid[2] * 255)},0.8)`;
    ctx.shadowBlur = 10;
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.restore();
    ctx.save();
    ctx.clip(path);
    // Head bead: a soft bright highlight centred on the head, so the
    // front of the bird carries a distinct bright bead the eye can
    // lock onto as a head (the fill gradient centres lower, on the
    // body). Without it the head, the smallest part of the outline,
    // disappears into the wing dome at gameplay size.
    const hg = ctx.createRadialGradient(px(0), py(0.10), 2, px(0), py(0.10), 30);
    hg.addColorStop(0, 'rgba(255,255,255,0.50)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, S, H);
    if (skin.glyph.darkHeart) {
      // Eclipse: a dark heart under a bright rim and core (spec 2.4).
      const dg = ctx.createRadialGradient(S / 2, py(0.32), 4, S / 2, py(0.32), S * 0.30);
      dg.addColorStop(0, 'rgba(10,4,24,0.88)');
      dg.addColorStop(1, 'rgba(10,4,24,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, S, H);
      ctx.fillStyle = `rgba(${Math.round(skin.bright[0] * 255)},${Math.round(skin.bright[1] * 255)},${Math.round(skin.bright[2] * 255)},0.95)`;
      ctx.beginPath(); ctx.arc(S / 2, py(0.25), 5, 0, Math.PI * 2); ctx.fill();
    }
    if (skin.glyph.facets) {
      // Frost: faint facet lines, like light through ice.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(S * (0.15 + i * 0.11), H * 0.06);
        ctx.lineTo(S * (0.30 + i * 0.09), H * 0.44);
        ctx.stroke();
      }
    }
    if (skin.glyph.sparkles) {
      // Celestial: a sparse star-sparkle subset inside the fill.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      for (let i = 0; i < 26; i++) {
        const x = S * (0.2 + rnd() * 0.6), y = H * (0.08 + rnd() * 0.84), r = 1 + rnd() * 1.8;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    // Bright rim, strongest on Eclipse (its readability carrier).
    ctx.strokeStyle = `rgba(${Math.round(skin.bright[0] * 255)},${Math.round(skin.bright[1] * 255)},${Math.round(skin.bright[2] * 255)},${skin.glyph.darkHeart ? 0.95 : 0.45})`;
    ctx.lineWidth = skin.glyph.darkHeart ? 3 : 1.5;
    ctx.stroke(path);
    const brightCss = `rgb(${Math.round(skin.bright[0] * 255)},${Math.round(skin.bright[1] * 255)},${Math.round(skin.bright[2] * 255)})`;
    // The beak: a bright wedge at the outline's spike, drawn over the
    // fill so the head ends in a visible point, not a rounded blob.
    ctx.fillStyle = brightCss;
    ctx.beginPath();
    ctx.moveTo(px(-0.058), py(0.050)); ctx.lineTo(px(0), py(-0.012)); ctx.lineTo(px(0.058), py(0.050));
    ctx.closePath(); ctx.fill();
    // Eyes: a dark pair on the head (bright on Eclipse, whose head is
    // the dark heart), small in flight and clear in the large capture.
    ctx.fillStyle = skin.glyph.darkHeart ? 'rgba(240,235,255,0.92)' : 'rgba(26,10,6,0.82)';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.arc(px(0.055 * side), py(0.095), 3.1, 0, Math.PI * 2); ctx.fill();
    }
    // Crest treatment on the head: a fan of slim spikes sweeping back
    // over the neck (toward the tail), per skin style. Only Celestial's
    // crown stands forward off the head, as a crown should.
    ctx.fillStyle = brightCss;
    const hx = S / 2, hy = py(0.095);
    const spike = (dx: number, len: number, w: number, splay: number) => {
      ctx.beginPath();
      ctx.moveTo(hx + dx - w, hy - 2); ctx.lineTo(hx + dx + splay, hy + len); ctx.lineTo(hx + dx + w, hy - 2);
      ctx.closePath(); ctx.fill();
    };
    const crownTri = (dx: number, h: number, w: number) => {
      ctx.beginPath();
      ctx.moveTo(hx + dx - w, hy + 2); ctx.lineTo(hx + dx, hy - h); ctx.lineTo(hx + dx + w, hy + 2);
      ctx.closePath(); ctx.fill();
    };
    if (skin.glyph.crest === 'tuft') {
      ctx.beginPath(); ctx.arc(hx, hy - 3, 4.5, 0, Math.PI * 2); ctx.fill();
      spike(-6, 11, 3.5, -3); spike(6, 11, 3.5, 3);
    } else if (skin.glyph.crest === 'spikes') { spike(-8, 20, 3, -5); spike(0, 24, 3, 0); spike(8, 20, 3, 5); }
    else if (skin.glyph.crest === 'rays') { for (let i = -2; i <= 2; i++) spike(i * 7, 23 - Math.abs(i) * 3, 2.6, i * 4); }
    else if (skin.glyph.crest === 'crown') { crownTri(-8, 13, 4); crownTri(0, 18, 4); crownTri(8, 13, 4); }
    else if (skin.glyph.crest === 'swept') {
      spike(0, 15, 3, 0);
      ctx.beginPath(); ctx.moveTo(hx - 2, hy - 2); ctx.lineTo(hx - 27, hy + 19); ctx.lineTo(hx - 5, hy + 6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx + 2, hy - 2); ctx.lineTo(hx + 27, hy + 19); ctx.lineTo(hx + 5, hy + 6); ctx.closePath(); ctx.fill();
    } else if (skin.glyph.crest === 'leaf') {
      ctx.beginPath(); ctx.ellipse(hx, hy + 9, 4.5, 11, 0.15, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    this.glyphTextures.set(skin.id, tex);
    return tex;
  }

  private initThree() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvasRef.nativeElement, alpha: true, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.z = 5;
    
    // Atmospheric Core Glow
    const glowGeo = new THREE.PlaneGeometry(400, 400);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bgGlow = new THREE.Mesh(glowGeo, glowMat);
    this.bgGlow.position.set(0, 0, -50);
    this.scene.add(this.bgGlow);

    this.updateBounds();
  }

  private updateBounds() {
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const height = 2 * Math.tan(vFOV / 2) * Math.abs(this.camera.position.z + 15);
    this.boundY = height / 2;
    this.boundX = (height * this.camera.aspect) / 2;
    // Bird size is defined in logical units (playtest round 1, phoenix
    // visibility): the wingspan is a fixed share (about 26 percent) of
    // the smaller visible dimension, so the phoenix reads at the same
    // relative size on a small phone, a landscape phone, and a tablet.
    // The old formula scaled off window.innerWidth alone, which shrank
    // the bird to a faint dotted outline of about 65 px on phones.
    // Wingspan in world units is 8 * birdScale (base x spans -4..4).
    const minVisible = Math.min(this.boundX * 2, this.boundY * 2);
    this.birdScale = Math.max(0.45, Math.min(0.9, (minVisible * 0.26) / 8));
  }

  private createParticles() {
    const geometry = new THREE.BufferGeometry();
    // Ambient field budget (spec Section 1.4): a per-world budget of
    // 3000 to 4500 points by atmosphere density, drawn from this one
    // buffer by draw range. The pre-overhaul field ran 7000, over
    // the budget the spec sets; the savings fund the parallax and
    // ground layers of the Stage 6 theme scenes.
    const count = 4500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * this.ambientBoxSize;
      positions[i+1] = (Math.random() - 0.5) * this.ambientBoxSize;
      if (i < 3150 * 3) positions[i+2] = (Math.random() - 0.5) * 40 - 10;
      else positions[i+2] = Math.random() * 8 - 4;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, this.atmosphereCount);
    const material = new THREE.PointsMaterial({ size: 0.025, vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }





  private createCosmetics() {
    // Golden Aura (Detailed Particles)
    const auraCount = 1000;
    const auraGeo = new THREE.BufferGeometry();
    const auraPos = new Float32Array(auraCount * 3);
    const auraBase = new Float32Array(auraCount * 3); // Store original relative positions
    const auraCol = new Float32Array(auraCount * 3);
    for (let i = 0; i < auraCount; i++) {
        // Swirling vortex shape
        const radius = 2.5 + Math.random() * 1.5;
        const theta = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * 6; // Spread vertically
        
        auraBase[i*3] = radius * Math.cos(theta);
        auraBase[i*3+1] = y;
        auraBase[i*3+2] = radius * Math.sin(theta);
        
        auraPos[i*3] = auraBase[i*3];
        auraPos[i*3+1] = auraBase[i*3+1];
        auraPos[i*3+2] = auraBase[i*3+2];
        
        // Golden/Orange hues
        auraCol[i*3] = 1.0;
        auraCol[i*3+1] = 0.5 + Math.random() * 0.4;
        auraCol[i*3+2] = Math.random() * 0.2;
    }
    auraGeo.setAttribute('position', new THREE.BufferAttribute(auraPos, 3));
    auraGeo.setAttribute('basePosition', new THREE.BufferAttribute(auraBase, 3));
    auraGeo.setAttribute('color', new THREE.BufferAttribute(auraCol, 3));
    const auraMat = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
    this.goldenAuraMesh = new THREE.Points(auraGeo, auraMat);
    this.goldenAuraMesh.visible = false;
    this.scene.add(this.goldenAuraMesh);



    // Celestial Shield (Large Detailed Wireframe/Particle Sphere)
    const shieldCount = 600;
    const shieldGeo = new THREE.BufferGeometry();
    const shieldPos = new Float32Array(shieldCount * 3);
    const shieldBase = new Float32Array(shieldCount * 3);
    for (let i = 0; i < shieldCount; i++) {
        const phi = Math.acos(-1 + (2 * i) / shieldCount);
        const theta = Math.sqrt(shieldCount * Math.PI) * phi;
        const radius = 5.5; // Larger to cover whole body
        
        shieldBase[i*3] = radius * Math.cos(theta) * Math.sin(phi);
        shieldBase[i*3+1] = radius * Math.sin(theta) * Math.sin(phi);
        shieldBase[i*3+2] = radius * Math.cos(phi);
    }
    shieldGeo.setAttribute('position', new THREE.BufferAttribute(shieldPos, 3));
    shieldGeo.setAttribute('basePosition', new THREE.BufferAttribute(shieldBase, 3));
    const shieldMat = new THREE.PointsMaterial({ color: 0x00ffff, size: 0.2, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    this.celestialShieldMesh = new THREE.Points(shieldGeo, shieldMat);
    this.celestialShieldMesh.visible = false;
    
    // Smooth follow target for shield
    (this.celestialShieldMesh as any).targetPos = new THREE.Vector3();
    this.scene.add(this.celestialShieldMesh);

    // Cosmic Trail (Shorter, fading Particles)
    const trailGeo = new THREE.BufferGeometry();
    const trailCount = 150; // Shorter
    const trailPos = new Float32Array(trailCount * 3);
    const trailCol = new Float32Array(trailCount * 3);
    const trailSizes = new Float32Array(trailCount);
    const trailOpacities = new Float32Array(trailCount);

    for (let i = 0; i < trailCount; i++) {
       trailPos[i*3] = 10000; // hide initially
       trailPos[i*3+1] = 10000;
       trailPos[i*3+2] = 10000;
       
       trailCol[i*3] = i % 2 === 0 ? 1 : 0.6; 
       trailCol[i*3+1] = i % 2 === 0 ? 0.4 : 0.2;
       trailCol[i*3+2] = 0.8;
       
       trailSizes[i] = Math.max(0.05, 0.3 * (1 - i / trailCount)); // Shrink towards end
       trailOpacities[i] = Math.max(0, 0.8 * (1 - i / trailCount)); // Fade out
    }
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
    
    // We need custom shader for varying size/opacity on Points, or just basic Points with global fade.
    // To keep it simple, we'll use global fade but update vertex colors for opacity effect.
    // Add alpha to vertex color: r, g, b, a? THREE.PointsMaterial doesn't natively support vertex alphas without custom shader.
    // Alternatively, we just use color darkening as "fade".
    for (let i = 0; i < trailCount; i++) {
       const fade = Math.max(0.1, 1 - (i / trailCount));
       trailCol[i*3] *= fade;
       trailCol[i*3+1] *= fade;
       trailCol[i*3+2] *= fade;
    }
    
    const trailMat = new THREE.PointsMaterial({ size: 0.25, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending });
    this.cosmicTrailMesh = new THREE.Points(trailGeo, trailMat);
    this.cosmicTrailMesh.visible = false;
    this.scene.add(this.cosmicTrailMesh);
  }

  private initHistory(bird: PhoenixState) {
    const depth = -15;
    const startPos = new THREE.Vector3(0, -10, depth);
    const startDir = new THREE.Vector3(0, 1, 0);
    // Velocity is in world units per second; history entries are spaced
    // by the nominal distance travelled in one 60 fps frame.
    const speed = this.nominalBirdSpeed();
    const frameTravel = speed / 60;
    const startVel = startDir.clone().multiplyScalar(speed);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.MAX_HISTORY; i++) {
        const p = startPos.clone().sub(startDir.clone().multiplyScalar(i * frameTravel));
        bird.historyPos.push(p);
        dummy.position.copy(p);
        dummy.lookAt(p.clone().add(startDir));
        dummy.rotateY(Math.PI);
        bird.historyQuat.push(dummy.quaternion.clone());
    }
    bird.position.copy(startPos);
    bird.velocity.copy(startVel);
    bird.targetWaypoint.copy(startPos);
    this.mouseTarget.copy(startPos);
  }

  private createPhoenixMesh(bird: PhoenixState, skin: PhoenixSkin) {
    // Layered hybrid construction (spec Section 2.1): the particle body
    // is rebalanced so the inner body reads filled rather than a sparse
    // outline: about 45 percent inner body fill (sampled evenly from
    // the glyph silhouette), 35 percent wings and tail ribbon (the
    // historical distribution), 20 percent outer fringe with the most
    // flicker. The sampling change is only in how base positions are
    // chosen; the animation code that consumes them is unchanged in
    // structure. Fill points live in a second Points object at size
    // 0.34 (spec 2.1); the rest keep the round 1 size 0.30, opacity 1.0.
    const FILL_COUNT = 1800;
    const count = bird.phoenixCount;
    bird.basePositions = new Float32Array(count * 3);
    bird.inFill = new Uint8Array(count);
    bird.bufferIndex = new Uint16Array(count);
    bird.pointRegion = new Uint8Array(count);
    bird.sparkle = new Uint8Array(count);
    bird.ashVec = new Float32Array(count * 3);
    const mainPos = new Float32Array((count - FILL_COUNT) * 3);
    const mainCol = new Float32Array((count - FILL_COUNT) * 3);
    const fillPos = new Float32Array(FILL_COUNT * 3);
    const fillCol = new Float32Array(FILL_COUNT * 3);
    let mainNext = 0, fillNext = 0;
    const wingPoint = (): [number, number, number] => {
      const x = (Math.random() - 0.5) * 20;
      const z = 0.05 * (x * x) + Math.random() * 1.5 + 4;
      const y = Math.sin(Math.abs(x) * 0.3) * 1.5 + (Math.random() - 0.5) * 0.1;
      return [x, y, z];
    };
    const tailPoint = (): [number, number, number] => {
      const feather = Math.floor(Math.random() * 5);
      const z = 9 + Math.random() * 16;
      const x = (feather - 2) * (z - 9) * 0.15 + (Math.random() - 0.5) * 0.2;
      const y = -Math.pow(Math.abs(z - 9), 1.1) * 0.15 + (Math.random() - 0.5) * 0.2;
      return [x, y, z];
    };
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      let x = 0, y = 0, z = 0;
      let region = 0;
      if (i < FILL_COUNT) {
        // Inner body fill: rejection-sample the glyph silhouette in
        // normalized space (nx -1..1 across the wings, nz 0..1 head to
        // tail), mapped onto the same unscaled bird space as the other
        // samplers (x -10..10, z 0..25), with a thin body thickness.
        region = 1;
        let nx = 0, nz = 0, guard = 0;
        do { nx = Math.random() * 2 - 1; nz = Math.random(); guard++; } while (!pointInGlyph(nx, nz) && guard < 40);
        x = nx * 10;
        z = nz * 25;
        const thickness = 1.6 * (1 - Math.abs(nx) * 0.55) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, nz * 1.2)));
        y = (Math.random() - 0.5) * thickness;
        if (i % 37 === 0) bird.sparkle[i] = 1; // Celestial star subset (twinkles in the update loop)
      } else if (i < FILL_COUNT + 800) {
        [x, y, z] = wingPoint();
        region = 0;
      } else if (i < FILL_COUNT + 1400) {
        [x, y, z] = tailPoint();
        region = 0;
      } else {
        // Outer fringe: the historical body sphere and neck samplers,
        // pushed outward from the body axis so the fringe sits outside
        // the fill and carries the flame edge.
        region = 2;
        if (Math.random() < 0.5) {
          const u = Math.random() * Math.PI * 2; const v = Math.acos(2 * Math.random() - 1); const r = Math.cbrt(Math.random());
          x = r * Math.sin(v) * Math.cos(u) * 0.8 * 1.18;
          y = r * Math.sin(v) * Math.sin(u) * 0.8 * 1.18;
          z = 6 + (r * Math.cos(v) * 3) * 1.18;
        } else {
          z = Math.random() * 4; let radius = 0; if (z < 0.8) radius = z * 0.3; else if (z < 1.8) radius = 0.6 - Math.abs(z - 1.3) * 0.4; else radius = 0.2 + (z - 1.8) * 0.1;
          const angle = Math.random() * Math.PI * 2; const rr = Math.random() * radius * 1.3;
          x = Math.cos(angle) * rr; y = Math.sin(angle) * rr;
        }
      }
      z += (Math.random() - 0.5) * 0.5; if (z < 0) z = 0; const scale = 0.4;
      bird.basePositions[idx] = x * scale; bird.basePositions[idx + 1] = y * scale; bird.basePositions[idx + 2] = z * scale;
      bird.pointRegion[i] = region;
      // Death drift per point (Section 2.2 death state): a sideways
      // scatter and a downward fall amount, fixed at build time.
      bird.ashVec[idx] = (Math.random() - 0.5) * 1.2;
      bird.ashVec[idx + 1] = 0.6 + Math.random() * 1.6;
      bird.ashVec[idx + 2] = (Math.random() - 0.5) * 1.2;
      if (region === 1) {
        bird.inFill[i] = 1; bird.bufferIndex[i] = fillNext++;
        const j = bird.bufferIndex[i] * 3;
        fillPos[j] = x; fillPos[j + 1] = y; fillPos[j + 2] = z;
      } else {
        bird.inFill[i] = 0; bird.bufferIndex[i] = mainNext++;
        const j = bird.bufferIndex[i] * 3;
        mainPos[j] = x; mainPos[j + 1] = y; mainPos[j + 2] = z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mainPos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(mainCol, 3));
    const material = new THREE.PointsMaterial({ size: 0.3, vertexColors: true, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending });
    bird.particles = new THREE.Points(geometry, material);
    bird.particles.frustumCulled = false;
    bird.particles.renderOrder = 2;
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', new THREE.BufferAttribute(fillPos, 3));
    fillGeometry.setAttribute('color', new THREE.BufferAttribute(fillCol, 3));
    const fillMaterial = new THREE.PointsMaterial({ size: 0.34, vertexColors: true, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending });
    bird.fillParticles = new THREE.Points(fillGeometry, fillMaterial);
    bird.fillParticles.frustumCulled = false;
    bird.fillParticles.renderOrder = 2;
    bird.group = new THREE.Group();
    bird.group.add(bird.particles);
    bird.group.add(bird.fillParticles);
    this.scene.add(bird.group);

    // Silhouette core sprite layer (spec Section 2.1, layer 2): a
    // canvas-drawn phoenix glyph at about 0.85 times wingspan, between
    // the glow (behind in the spec's layering; round 1 keeps the glow
    // sprite on top in this build, renderOrder 999) and the particle
    // body (renderOrder 2). The plane is rotated so its texture up maps
    // to the bird's local forward (+Z after the history quaternion's
    // half-turn), its width to the wing axis. The plane is 1 by 1.25,
    // the bird's own aspect (20 units wide, 25 long), so the glyph is
    // not compressed head-to-tail against the particle fill that
    // samples the same outline. Oriented per frame from the head
    // history quaternion, like the particles.
    const coreGeo = new THREE.PlaneGeometry(1, 1.25);
    coreGeo.rotateX(Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      map: this.glyphTexture(skin), transparent: true, opacity: 0.9,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    bird.core = new THREE.Mesh(coreGeo, coreMat);
    bird.core.renderOrder = 1;
    bird.core.frustumCulled = false;
    bird.core.position.copy(bird.position);
    this.scene.add(bird.core);
    bird.skinId = skin.id;
    bird.glowSpanFactor = skin.glowSpan;

    // Visibility core: a soft radial glow sprite rides at the bird's
    // centre so the player can always find their phoenix at a glance.
    // Purely visual: physics and collision live in the game component's
    // Matter body and are unaffected by anything here.
    if (!this.glowTexture) this.glowTexture = this.createGlowTexture();
    const glowTex = skin.glowRing === 'eclipse' ? this.createRingGlowTexture()
      : skin.glowRing === 'halo' ? this.createHaloGlowTexture()
      : this.glowTexture;
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color(skin.bright[0], skin.bright[1], skin.bright[2]),
      transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false
    });
    bird.glow = new THREE.Sprite(glowMat);
    bird.glow.renderOrder = 999;
    bird.glow.position.copy(bird.position);
    this.scene.add(bird.glow);
  }

  private animate() {
    this.ngZone.runOutsideAngular(() => {
      const render = () => {
        // Delta time in seconds. All motion in this loop is integrated
        // against dt, so speeds are identical at 60, 90, and 120 Hz.
        // (The old code advanced the bird by a fixed amount per
        // animation frame, which doubled its speed at 120 Hz.) The bird
        // updates below run in substeps of at most 1/30 s: a single
        // clamped step would make the bird run slow whenever a device
        // dips under 30 fps, which the harness measured at large
        // viewports (crossing times ballooned to about 3.5 s there
        // while small screens stayed near 1.6 s).
        const nowMs = performance.now();
        const dt = this.lastFrameTime ? Math.min(0.25, (nowMs - this.lastFrameTime) / 1000) : 1 / 60;
        this.lastFrameTime = nowMs;

        // Ambient field motion follows the world's atmosphere record
        // (Stage 6): direction and speed are theme data for themed
        // worlds; unthemed worlds keep the shipped falling drift
        // (1.8 units per second, the moderate anchor).
        const positions = this.particles.geometry.attributes['position'].array as Float32Array;
        const halfBox = this.ambientBoxSize / 2;
        const aDir = this.atmosphereDir;
        const aSpd = this.atmosphereSpeed;
        for (let i = 0; i < positions.length; i += 3) {
          if (aDir === 'rising') {
            positions[i+1] += aSpd * dt;
            if (positions[i+1] > halfBox) { positions[i+1] = -halfBox; positions[i] = (Math.random() - 0.5) * this.ambientBoxSize; }
          } else if (aDir === 'horizontal') {
            positions[i] += aSpd * dt;
            if (positions[i] > halfBox) { positions[i] = -halfBox; positions[i+1] = (Math.random() - 0.5) * this.ambientBoxSize; }
          } else if (aDir === 'mixed') {
            if (this.themedWorldIndex === 9) {
              // Abyssal Rift (Stage 8): motes rise against
              // gravity on the seam's right side and fall on its
              // left (the seam stands at local x = 7, where its
              // planes stand); every tenth point is a star and
              // does not move at all, the game's only static
              // atmosphere (World 10 sheet).
              if ((i / 3) % 10 !== 0) {
                positions[i+1] += (positions[i] > 7 ? aSpd : -aSpd) * 0.6 * dt;
                if (positions[i+1] > halfBox) positions[i+1] = -halfBox;
                else if (positions[i+1] < -halfBox) positions[i+1] = halfBox;
              }
            } else {
              positions[i+1] += (i % 6 === 0 ? aSpd : -aSpd) * 0.6 * dt;
              if (positions[i+1] > halfBox) positions[i+1] = -halfBox;
              else if (positions[i+1] < -halfBox) positions[i+1] = halfBox;
            }
          } else if (aDir === 'suspended') {
            positions[i+1] -= aSpd * 0.06 * dt;
            if (positions[i+1] < -halfBox) positions[i+1] = halfBox;
          } else { // falling (the shipped behavior)
            positions[i+1] -= aSpd * dt;
            // Ashen Peaks wind sine (Stage 7): a slow lateral sway
            // on the fall, phased per point. Zero amplitude in every
            // other world, so their fall is unchanged.
            if (this.atmosphereSway > 0) positions[i] += Math.sin(this.themeTime * 0.7 + i * 0.37) * this.atmosphereSway * dt;
            // Blood Moon rain angle (Stage 8): a constant sideways
            // drift on the fall. Zero in every other world.
            if (this.atmosphereDriftX !== 0) {
              positions[i] += this.atmosphereDriftX * dt;
              if (positions[i] < -halfBox) positions[i] = halfBox;
              else if (positions[i] > halfBox) positions[i] = -halfBox;
            }
            if (positions[i+1] < -halfBox) { positions[i+1] = halfBox; positions[i] = (Math.random() - 0.5) * this.ambientBoxSize; }
          }
        }
        this.particles.geometry.attributes['position'].needsUpdate = true;
        this.particles.rotation.y += 0.006 * dt;
        // Suspended dust twinkles (Amethyst Void sheet): a slow
        // global shimmer on the field's opacity, nothing more.
        const ambMat = this.particles.material as THREE.PointsMaterial;
        ambMat.opacity = aDir === 'suspended' ? 0.6 * (0.82 + 0.18 * Math.sin(this.themeTime * 0.8)) : 0.6;

        // Theme backdrop animation (Stage 6): the composited
        // backdrop drifts slowly and counter-shifts against the
        // bird at a compromise of the sheets' far and mid scroll
        // factors (the layers share one plane; see the backdrop
        // field comment). The ambient particle field keeps its own
        // real depth, so the scene still parallaxes against the
        // backdrop as the bird moves.
        this.themeTime += dt;
        if (this.backdropMesh && this.backdropMesh.visible && this.backdropTex) {
          this.backdropTex.offset.x = (this.themeTime * 0.0028) % 1;
          this.backdropMesh.position.x = -this.bird.position.x * 0.08 * 2 * (49 / 20);
        }

        // Stage 8 set pieces. Blood Moon: the moon follows the
        // BGM clock (updateMoon repaints only on a lit-step
        // change, so the per-frame cost is two getters).
        if (this.moonMesh && this.moonMesh.visible) this.updateMoon();
        // Abyssal Rift: the seam pulses with the audio intensity
        // (the one reactive sky, spec Section 6), smoothed toward
        // the live value; a small idle shimmer keeps the seam
        // breathing where no analyser signal exists.
        if (this.riftCoreMesh && this.riftCoreMesh.visible && this.riftHaloMesh) {
          const target = this.audioService.getAudioIntensity();
          this.riftPulse += (target - this.riftPulse) * Math.min(1, dt * 5);
          const shimmer = 0.05 * Math.sin(this.themeTime * 1.3);
          (this.riftCoreMesh.material as THREE.MeshBasicMaterial).opacity = 0.52 + 0.40 * this.riftPulse + shimmer;
          (this.riftHaloMesh.material as THREE.MeshBasicMaterial).opacity = 0.17 + 0.28 * this.riftPulse + shimmer * 0.6;
          const sx = 1 + 0.18 * this.riftPulse;
          this.riftCoreMesh.scale.x = sx;
          this.riftHaloMesh.scale.x = sx;
        }
        // Neon Nebula: refresh the aurora tint on the snow twice
        // a second (band crossings take tens of seconds).
        if (this.themedWorldIndex === 6 && this.themeTime - this.lastAuroraTintAt > 0.5) {
          this.lastAuroraTintAt = this.themeTime;
          this.tintAuroraSnow();
        }

        // Dynamic pixel-ratio step-down (spec Section 1.4): while
        // the rolling frame time stays over 20 ms, step the ratio
        // down (2, 1.75, 1.5, 1.25) before any gameplay visual is
        // touched. Steps only ever go down within a session.
        this.frameEmaMs = this.frameEmaMs * 0.96 + dt * 1000 * 0.04;
        if (nowMs - this.lastPrEvalMs > 2000) {
          this.lastPrEvalMs = nowMs;
          // The ladder only ever steps DOWN from the renderer's
          // starting ratio: on a client whose devicePixelRatio is
          // already at or below a rung, that rung is skipped (an
          // earlier draft stepped a DPR-1 client UP to 1.75 before
          // coming back down, making slow frames slower).
          const initialPr = Math.min(window.devicePixelRatio || 1, 2);
          const prSteps = [2, 1.75, 1.5, 1.25, 1].filter(s => s <= initialPr + 0.001);
          if (prSteps.length === 0 || prSteps[0] !== initialPr) prSteps.unshift(initialPr);
          if (this.frameEmaMs > 20 && this.pixelRatioStep < prSteps.length - 1) {
            this.pixelRatioStep++;
            this.renderer.setPixelRatio(prSteps[this.pixelRatioStep]);
            this.renderer.setSize(window.innerWidth, window.innerHeight);
          }
        }

        // Cruise speed in world units per second at multiplier 1, from
        // the canonical crossing time. No window.innerWidth factor: the
        // visible width already encodes the screen size.
        const baseSpeed = this.nominalBirdSpeed();

        let targetForMainBird = this.mouseTarget;
        if (this.gameState.currentGameMode() === 'ai_vs_ai' && this.gameState.activeScreen() === 'game') {
            const ai2Mouse = this.gameState.ai2MousePos();
            const ai2Vec = new THREE.Vector3(
                (ai2Mouse.x / window.innerWidth) * 2 - 1,
                -(ai2Mouse.y / window.innerHeight) * 2 + 1,
                0.5
            );
            ai2Vec.unproject(this.camera);
            ai2Vec.sub(this.camera.position).normalize();
            const dist = (-15 - this.camera.position.z) / ai2Vec.z;
            targetForMainBird = this.camera.position.clone().add(ai2Vec.multiplyScalar(dist));
        }
        
        // Hide AI Bird if not in battle mode or not playing
        const isBattle = (this.gameState.currentGameMode() === 'battle' || this.gameState.currentGameMode() === 'ai_vs_ai') && this.gameState.activeScreen() === 'game';
        this.aiBird.group.visible = isBattle;
        if (this.aiBird.core) this.aiBird.core.visible = isBattle;
        if (this.aiBird.glow) this.aiBird.glow.visible = isBattle;
        let aiTarget3D: THREE.Vector3 | null = null;
        if (isBattle) {
            const aiMouse = this.gameState.aiMousePos();
            const aiVec = new THREE.Vector3(
                (aiMouse.x / window.innerWidth) * 2 - 1,
                -(aiMouse.y / window.innerHeight) * 2 + 1,
                0.5
            );
            aiVec.unproject(this.camera);
            aiVec.sub(this.camera.position).normalize();
            const dist = (-15 - this.camera.position.z) / aiVec.z;
            aiTarget3D = this.camera.position.clone().add(aiVec.multiplyScalar(dist));
        }

        // Substepped bird updates: simulate the full frame time in
        // slices of at most 1/30 s so wall-clock speed stays exact at
        // any frame rate, high or low.
        const subSteps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 30))));
        const sdt = dt / subSteps;
        const sFrameScale = sdt * 60;
        for (let s = 0; s < subSteps; s++) {
            this.updateBirdPhysics(this.bird, targetForMainBird, baseSpeed, sdt, sFrameScale, false);
            if (isBattle && aiTarget3D) {
                this.updateBirdPhysics(this.aiBird, aiTarget3D, baseSpeed, sdt, sFrameScale, true);
            }
        }

        this.updatePlayerVisualStates(dt, nowMs);

        this.syncEntities();

        this.renderer.render(this.scene, this.camera);
        
        this.wasGameScreen = this.gameState.activeScreen() === 'game';
        this.animationId = requestAnimationFrame(render);
      };
      render();
    });
  }

  // Section 2.2 animation states that the per-frame bird physics does
  // not own: hit flash, the death sequence (cool to ash), and the
  // rebirth sequence (implode, flare, reform). Driven entirely by
  // signals the game state already exposes; no gameplay timing changes.
  // Runs after the bird physics substeps, before the render.
  private updatePlayerVisualStates(dt: number, nowMs: number) {
    const bird = this.bird;
    if (!bird || !bird.particles || !bird.fillParticles) return;
    const deadMenu = this.gameState.isDeadMenuOpen();
    const rebirthing = this.gameState.isRebirthing();
    const onGame = this.gameState.activeScreen() === 'game';

    // Death begins: capture the bird exactly as it died.
    if (deadMenu && !this.prevDeadMenu && onGame && this.visState === 'alive') {
      this.visState = 'dying';
      this.visT0 = nowMs;
      this.captureBirdBuffers(bird, this.ashStartPos, this.ashStartCol);
    }
    // Revive (dead menu closes, run continues): rebirth sequence.
    if (!deadMenu && this.prevDeadMenu) {
      if (onGame && (this.visState === 'dying' || this.visState === 'dead')) {
        this.beginRebirth(bird, nowMs, true);
      } else {
        this.visState = 'alive';
        this.applyBirdColors(bird, phoenixSkinById(bird.skinId));
      }
    }
    // The Rebirth ability's ash state ends: flare and reform.
    if (!rebirthing && this.prevRebirthing && onGame && this.visState === 'alive') {
      this.captureBirdBuffers(bird, this.ashStartPos, this.ashStartCol);
      this.beginRebirth(bird, nowMs, false);
    }
    this.prevDeadMenu = deadMenu;
    this.prevRebirthing = rebirthing;

    // Hit flash: takeDamage grants a fresh immortalUntil window on
    // every hit (500 ms), so a rising edge while alive in a run is a
    // damage event. One 80 ms flash per hit, never strobing.
    const iu = this.gameState.immortalUntil;
    if (iu > this.lastImmortalSeen + 1 && onGame && this.visState === 'alive' && !rebirthing) {
      bird.flashUntil = nowMs + 80;
    }
    this.lastImmortalSeen = iu;

    if (this.visState === 'dying' || this.visState === 'dead') {
      const p = Math.min(1, (nowMs - this.visT0) / 800);
      if (this.visState === 'dying') {
        const e = p * p;
        this.writeBirdPoints(bird, (k, j, arr) => {
          arr[j] = this.ashStartPos[k * 3] + bird.ashVec[k * 3] * e * this.birdScale;
          arr[j + 1] = this.ashStartPos[k * 3 + 1] - bird.ashVec[k * 3 + 1] * e * this.birdScale * 2.2;
          arr[j + 2] = this.ashStartPos[k * 3 + 2] + bird.ashVec[k * 3 + 2] * e * this.birdScale;
        });
        this.writeBirdColors(bird, (k, j, arr) => {
          arr[j] = this.ashStartCol[k * 3] + (0.32 - this.ashStartCol[k * 3]) * p;
          arr[j + 1] = this.ashStartCol[k * 3 + 1] + (0.32 - this.ashStartCol[k * 3 + 1]) * p;
          arr[j + 2] = this.ashStartCol[k * 3 + 2] + (0.34 - this.ashStartCol[k * 3 + 2]) * p;
        });
        if (p >= 1) this.visState = 'dead';
      }
      // Core fades out, glow shrinks to an ember (spec 2.2 death).
      if (bird.core) {
        const cm = bird.core.material as THREE.MeshBasicMaterial;
        cm.opacity = 0.9 * (1 - p);
        bird.core.visible = p < 1;
      }
      if (bird.glow) {
        const span = 8 * this.birdScale * bird.glowSpanFactor * (1 - 0.75 * p);
        bird.glow.scale.set(span, span, 1);
        bird.glow.position.copy(bird.position);
        (bird.glow.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - p) + 0.08;
      }
      return;
    }

    if (this.visState === 'rebirth') {
      const t = (nowMs - this.visT0) / 1000;
      if (t < 0.4) {
        // Implode: rendered points gather from the ash positions into
        // the live physics positions (which the physics loop just
        // wrote), colors warming back from ash to the skin.
        const e = 1 - Math.pow(1 - t / 0.4, 3);
        const mainPos = bird.particles.geometry.attributes['position'].array as Float32Array;
        const fillPos = bird.fillParticles.geometry.attributes['position'].array as Float32Array;
        for (let k = 0; k < bird.phoenixCount; k++) {
          const arr = bird.inFill[k] ? fillPos : mainPos;
          const j = bird.bufferIndex[k] * 3;
          arr[j] = this.ashStartPos[k * 3] + (arr[j] - this.ashStartPos[k * 3]) * e;
          arr[j + 1] = this.ashStartPos[k * 3 + 1] + (arr[j + 1] - this.ashStartPos[k * 3 + 1]) * e;
          arr[j + 2] = this.ashStartPos[k * 3 + 2] + (arr[j + 2] - this.ashStartPos[k * 3 + 2]) * e;
        }
        bird.particles.geometry.attributes['position'].needsUpdate = true;
        bird.fillParticles.geometry.attributes['position'].needsUpdate = true;
        if (bird.core) (bird.core.material as THREE.MeshBasicMaterial).opacity = 0.9 * e;
        this.writeBirdColors(bird, (k, j, arr) => {
          arr[j] = this.ashStartCol[k * 3] + (this.rebirthTargetCol[k * 3] - this.ashStartCol[k * 3]) * e;
          arr[j + 1] = this.ashStartCol[k * 3 + 1] + (this.rebirthTargetCol[k * 3 + 1] - this.ashStartCol[k * 3 + 1]) * e;
          arr[j + 2] = this.ashStartCol[k * 3 + 2] + (this.rebirthTargetCol[k * 3 + 2] - this.ashStartCol[k * 3 + 2]) * e;
        });
      } else if (t < 0.52) {
        // Flare: one bright frame window, glow at 2 times wingspan.
        if (bird.glow) {
          const span = 8 * this.birdScale * 2.0;
          bird.glow.scale.set(span, span, 1);
          (bird.glow.material as THREE.SpriteMaterial).opacity = 0.85;
        }
        if (bird.core) (bird.core.material as THREE.MeshBasicMaterial).opacity = 1.0;
        const pm = bird.particles.material as THREE.PointsMaterial;
        pm.color.setRGB(1.7, 1.7, 1.7);
        const fm = bird.fillParticles.material as THREE.PointsMaterial;
        fm.color.setRGB(1.7, 1.7, 1.7);
      } else {
        this.visState = 'alive';
        bird.reformUntil = nowMs + 450; // reform with a flap burst
        this.applyBirdColors(bird, phoenixSkinById(bird.skinId));
        if (bird.core) (bird.core.material as THREE.MeshBasicMaterial).opacity = 0.9;
      }
    }

    // Hit flash overlay (80 ms): core sprite and inner fill flash white.
    if (nowMs < bird.flashUntil && this.visState === 'alive') {
      if (bird.core) {
        const cm = bird.core.material as THREE.MeshBasicMaterial;
        cm.color.setRGB(2.2, 2.2, 2.2);
      }
      const fm = bird.fillParticles.material as THREE.PointsMaterial;
      fm.color.setRGB(1.9, 1.9, 1.9);
    } else {
      if (bird.core) {
        const cm = bird.core.material as THREE.MeshBasicMaterial;
        if (cm.color.r !== 1 || cm.color.g !== 1 || cm.color.b !== 1) cm.color.setRGB(1, 1, 1);
      }
      const fm = bird.fillParticles.material as THREE.PointsMaterial;
      const pm = bird.particles.material as THREE.PointsMaterial;
      if (fm.color.r !== pm.color.r || fm.color.g !== pm.color.g || fm.color.b !== pm.color.b) {
        fm.color.copy(pm.color);
      }
    }
  }

  private beginRebirth(bird: PhoenixState, nowMs: number, fromDeath: boolean) {
    this.visState = 'rebirth';
    this.visT0 = nowMs;
    if (fromDeath) {
      // Colors start from the cooled ash the death sequence left.
      this.captureBirdColors(bird, this.ashStartCol);
    }
    const skin = phoenixSkinById(bird.skinId);
    for (let k = 0; k < bird.phoenixCount; k++) {
      const c = this.colorForPoint(bird, skin, k);
      this.rebirthTargetCol[k * 3] = c[0];
      this.rebirthTargetCol[k * 3 + 1] = c[1];
      this.rebirthTargetCol[k * 3 + 2] = c[2];
    }
    if (bird.core) bird.core.visible = true;
  }

  private captureBirdBuffers(bird: PhoenixState, posOut: Float32Array, colOut: Float32Array) {
    const mainPos = bird.particles.geometry.attributes['position'].array as Float32Array;
    const fillPos = bird.fillParticles!.geometry.attributes['position'].array as Float32Array;
    for (let k = 0; k < bird.phoenixCount; k++) {
      const arr = bird.inFill[k] ? fillPos : mainPos;
      const j = bird.bufferIndex[k] * 3;
      posOut[k * 3] = arr[j]; posOut[k * 3 + 1] = arr[j + 1]; posOut[k * 3 + 2] = arr[j + 2];
    }
    this.captureBirdColors(bird, colOut);
  }

  private captureBirdColors(bird: PhoenixState, colOut: Float32Array) {
    const mainCol = bird.particles.geometry.attributes['color'].array as Float32Array;
    const fillCol = bird.fillParticles!.geometry.attributes['color'].array as Float32Array;
    for (let k = 0; k < bird.phoenixCount; k++) {
      const arr = bird.inFill[k] ? fillCol : mainCol;
      const j = bird.bufferIndex[k] * 3;
      colOut[k * 3] = arr[j]; colOut[k * 3 + 1] = arr[j + 1]; colOut[k * 3 + 2] = arr[j + 2];
    }
  }

  private writeBirdPoints(bird: PhoenixState, fn: (k: number, j: number, arr: Float32Array) => void) {
    const mainPos = bird.particles.geometry.attributes['position'].array as Float32Array;
    const fillPos = bird.fillParticles!.geometry.attributes['position'].array as Float32Array;
    for (let k = 0; k < bird.phoenixCount; k++) {
      fn(k, bird.bufferIndex[k] * 3, bird.inFill[k] ? fillPos : mainPos);
    }
    bird.particles.geometry.attributes['position'].needsUpdate = true;
    bird.fillParticles!.geometry.attributes['position'].needsUpdate = true;
  }

  private writeBirdColors(bird: PhoenixState, fn: (k: number, j: number, arr: Float32Array) => void) {
    const mainCol = bird.particles.geometry.attributes['color'].array as Float32Array;
    const fillCol = bird.fillParticles!.geometry.attributes['color'].array as Float32Array;
    for (let k = 0; k < bird.phoenixCount; k++) {
      fn(k, bird.bufferIndex[k] * 3, bird.inFill[k] ? fillCol : mainCol);
    }
    bird.particles.geometry.attributes['color'].needsUpdate = true;
    bird.fillParticles!.geometry.attributes['color'].needsUpdate = true;
  }

  private wasGameScreen = false;

  private updateBirdPhysics(bird: PhoenixState, targetWaypoint: THREE.Vector3, baseSpeed: number, dt: number, frameScale: number, isAi: boolean) {
      if (!this.gameState.isPaused() && !this.gameState.isDeadMenuOpen()) {
          
          if (!this.wasGameScreen && this.gameState.activeScreen() === 'game') {
              bird.position.copy(targetWaypoint);
              bird.targetWaypoint.copy(targetWaypoint);
          }
          
          // Player bird follows the mouse on the game screen AND on the menu (so it's controllable
          // the moment the app loads). The AI bird only animates in-game.
          const isMenuScreen = this.gameState.activeScreen() === 'menu';
          if (this.gameState.activeScreen() === 'game' || (!isAi && isMenuScreen)) {
          const overridePos = isAi ? this.gameState.aiPhoenixOverridePosition() : this.gameState.phoenixOverridePosition();
          if (overridePos) {
              const vec = new THREE.Vector3(
                  (overridePos.x / window.innerWidth) * 2 - 1,
                  -(overridePos.y / window.innerHeight) * 2 + 1,
                  0.5
              );
              vec.unproject(this.camera);
              vec.sub(this.camera.position).normalize();
              const dist = (-15 - this.camera.position.z) / vec.z;
              targetWaypoint = this.camera.position.clone().add(vec.multiplyScalar(dist));
          }

          const isRebirthingNow = this.gameState.isRebirthing() && !isAi;

          const mat = bird.particles.material as THREE.PointsMaterial;
          if (isRebirthingNow) {
              mat.color.setRGB(0.2, 0.2, 0.2); // Ash color
              bird.velocity.set(0, 0, 0);
          } else {
              if (!isAi) {
                  if (this.gameState.isDrilling()) {
                      mat.color.setRGB(1.5, 0.3, 0.3); // Intense red glow
                  } else {
                      mat.color.setRGB(1, 1, 1); // Normal color
                  }
                  if (Date.now() < this.gameState.immortalUntil) {
                      mat.opacity = Math.floor(Date.now() / 250) % 2 === 0 ? 0.15 : 1.0;
                  } else {
                      mat.opacity = 1.0;
                  }
                  // Dash entry: a short white-hot core flash (spec 2.2).
                  const drillingNow = this.gameState.isDrilling();
                  if (drillingNow && !bird.wasDrilling) bird.flashUntil = performance.now() + 120;
                  bird.wasDrilling = drillingNow;
                  // Meteor Rush entry (S2): the same white-hot flash
                  // marks the rush window opening.
                  const rushingNow = this.gameState.isMeteorRushing();
                  if (rushingNow && !bird.wasRushing) bird.flashUntil = performance.now() + 120;
                  bird.wasRushing = rushingNow;
              }

              // Flap rate (spec 2.2): menu cruise is calmer (0.6x), a
              // sustained climb over 0.4 s becomes a flap burst (1.6x),
              // and the rebirth reform window bursts as well. Cruise in
              // level flight stays at the historical rate.
              if (!isAi) {
                  if (this.gameState.activeScreen() === 'game' && bird.velocity.y > 0.3 * Math.max(1, bird.velocity.length())) {
                      bird.climbTime += dt;
                  } else {
                      bird.climbTime = Math.max(0, bird.climbTime - dt * 2);
                  }
                  bird.flapRate = this.gameState.activeScreen() === 'menu' ? 0.6
                      : (Date.now() < bird.reformUntil || bird.climbTime > 0.4) ? 1.6 : 1.0;
              } else {
                  bird.flapRate = 1.0;
              }
              bird.flapTime += 0.04 * frameScale * bird.flapRate;

              // The fill layer shares the bird's tint and blink state.
              if (bird.fillParticles) {
                  const fm = bird.fillParticles.material as THREE.PointsMaterial;
                  fm.color.copy(mat.color);
                  fm.opacity = mat.opacity;
              }

              // Frame-rate independent waypoint smoothing: the old fixed
              // 0.1 lerp per frame converged twice as fast at 120 Hz.
              bird.targetWaypoint.lerp(targetWaypoint, 1 - Math.pow(0.9, frameScale));

              const toTarget = bird.targetWaypoint.clone().sub(bird.position);
              const distSqToTarget = toTarget.lengthSq();

              let speedMult = 1.0;
              if (!isAi) {
                  if (this.gameState.activeScreen() === 'menu') {
                      speedMult = 1.0; // Menu: plain mouse-follow regardless of saved mode
                  } else if (this.gameState.currentGameMode() === 'ai_vs_ai') {
                      speedMult = this.gameState.ai2PhoenixSpeed() / ParticleBgComponent.BASE_SPEED_STAT;
                  } else {
                      speedMult = this.gameState.currentStats().speed / ParticleBgComponent.BASE_SPEED_STAT;
                      if (Date.now() < this.gameState.speedBoostUntil) speedMult *= 2.0;
                      if (this.gameState.isDrilling()) {
                          const modifiers = this.gameState.currentStats().unlockedAbilities['drill_attack']?.modifiers;
                          if (modifiers && modifiers['speed']) speedMult *= modifiers['speed'];
                      }
                  }
              } else {
                  speedMult = this.gameState.aiPhoenixSpeed() / ParticleBgComponent.BASE_SPEED_STAT;
              }

              // Cruise speed for this bird in world units per second.
              const cruiseSpeed = baseSpeed * speedMult;

              // Steering: rotate the heading toward the target at a
              // capped turn rate, integrated over dt. The old code (and
              // the first draft of this fix) blended the heading a few
              // percent toward the target each frame, which has a trap:
              // when the heading points almost exactly AWAY from the
              // target, the blend pull is parallel to the heading, the
              // steering cancels out, and the bird flies off in a
              // straight line and never comes back. The round 4-13
              // harness caught exactly that on game entry: the phoenix
              // left the screen and gameplay had no visible bird.
              // Angle-based steering always makes progress, with an
              // explicit perpendicular escape for the exactly-opposite
              // case. All flight stays in the z = -15 plane: every
              // target lives in that plane, so z drift is clamped out.
              const toTargetPlanar = toTarget.clone(); toTargetPlanar.z = 0;
              const currentDir = bird.velocity.lengthSq() > 0
                  ? bird.velocity.clone() : new THREE.Vector3(0, cruiseSpeed, 0);
              currentDir.z = 0;
              if (currentDir.lengthSq() < 1e-9) currentDir.set(0, cruiseSpeed, 0);
              currentDir.normalize();
              const desiredDir = toTargetPlanar.lengthSq() > 1e-9
                  ? toTargetPlanar.clone().normalize() : currentDir.clone();
              if (Math.abs(desiredDir.x) > 0.2) {
                  // Remembered for the Air Roll side choice (Section 2.3).
                  const mv0 = isAi ? this.gameState.aiMovement
                      : (this.gameState.activeScreen() === 'game' && this.gameState.currentGameMode() === 'ai_vs_ai')
                          ? this.gameState.ai2Movement : this.gameState.playerMovement;
                  mv0.lastLateralSign = Math.sign(desiredDir.x);
              }

              // --- Systems S1 movement kit (spec Section 2) ---
              // Every bird flies on its own MovementState: the
              // player's, the Battle rival's, or (for the main bird in
              // AI vs AI) the second AI's. The game component requests
              // verbs and reads i-frames; motion, glide tracking, and
              // stamina regeneration live here. Nothing here changes
              // the top speed: dash and roll are multiples of this same
              // cruiseSpeed, and the brake only ever slows down.
              const onGameScreen = this.gameState.activeScreen() === 'game';
              const move = isAi ? this.gameState.aiMovement
                  : (onGameScreen && this.gameState.currentGameMode() === 'ai_vs_ai')
                      ? this.gameState.ai2Movement : this.gameState.playerMovement;
              const moveNow = Date.now();
              const brakingNow = onGameScreen && move.braking;
              this.gameState.tickMovement(move, dt);

              // Glide tracking (Section 2.6): heading change under
              // 10 deg/s for 1.2 s builds Glide; a hard turn (over
              // 25 deg/s), a dash, a roll, or a hit ends it.
              const headingNow = Math.atan2(currentDir.y, currentDir.x);
              if (move.lastHeading !== null && dt > 0) {
                  let dA = headingNow - move.lastHeading;
                  while (dA > Math.PI) dA -= Math.PI * 2;
                  while (dA < -Math.PI) dA += Math.PI * 2;
                  const rate = Math.abs(dA) / dt;
                  if (move.gliding) {
                      if (rate > 0.436) this.gameState.endGlide(move);
                  } else if (rate < 0.1745) {
                      move.straightTime += dt;
                      if (move.straightTime >= 1.2) move.gliding = true;
                  } else {
                      move.straightTime = 0;
                  }
              }
              move.lastHeading = headingNow;

              const dashing = onGameScreen && moveNow < move.dashUntil;
              if (dashing && !bird.wasDashing && !isAi) bird.flashUntil = performance.now() + 120;
              bird.wasDashing = dashing;

              // Air Roll consume (Section 2.3): the spend happens here
              // because the lateral direction needs the live heading.
              // The hop goes perpendicular to the heading, to the side
              // away from the nearest edge when one side is closed,
              // otherwise toward the last lateral steering input.
              if (onGameScreen && move.rollRequestedAt > 0 && moveNow >= move.rollUntil) {
                  move.rollRequestedAt = 0;
                  if (this.gameState.spendStamina(move, STAMINA.rollCost)) {
                      const candA = { x: -currentDir.y, y: currentDir.x };
                      const useX = Math.abs(candA.x) >= Math.abs(candA.y);
                      const bound = useX ? this.boundX : this.boundY;
                      const posAlong = useX ? bird.position.x : bird.position.y;
                      const compA = useX ? candA.x : candA.y;
                      const roomA = compA >= 0 ? bound - posAlong : posAlong + bound;
                      const roomB = (useX ? this.boundX * 2 : this.boundY * 2) - roomA;
                      let sign = 1;
                      if (roomA < bound * 0.35 && roomB >= bound * 0.35) {
                          sign = -1;
                      } else if (useX && roomA >= bound * 0.35 && roomB >= bound * 0.35) {
                          if (Math.sign(compA) !== 0 && Math.sign(compA) !== move.lastLateralSign) sign = -1;
                      }
                      move.rollDirX = candA.x * sign;
                      move.rollDirY = candA.y * sign;
                      move.rollSide = (currentDir.x * move.rollDirY - currentDir.y * move.rollDirX) > 0 ? 1 : -1;
                      move.rollUntil = moveNow + STAMINA.rollMs;
                      move.gliding = false;
                      move.straightTime = 0;
                  }
              }
              const rolling = onGameScreen && moveNow < move.rollUntil;

              // Dead-zone hover (Section 2.1): within 6 reference px of
              // the target the bird holds position and idles its flap
              // at 0.6 rate instead of orbiting the point. The capture
              // band is wider than the hold radius on purpose: at
              // cruise a single substep travels farther than the 6 px
              // zone is wide, so a zone-only test is stepped over and
              // the bird limit-cycles around the point forever. Inside
              // the band the velocity decays hard enough to park.
              const minDimPx = Math.min(window.innerWidth, window.innerHeight);
              const deadZoneWorld = 6 * (minDimPx / 412) * ((this.boundX * 2) / Math.max(1, window.innerWidth));
              const hovering = !dashing && !rolling && Math.sqrt(distSqToTarget) < deadZoneWorld * 2.5;

              if (dashing) {
                  // Dash direction is stored screen-space; world y flips.
                  bird.velocity.set(move.dashDirX, -move.dashDirY, 0).multiplyScalar(cruiseSpeed * 2.2);
              } else if (rolling) {
                  bird.velocity.set(move.rollDirX, move.rollDirY, 0).multiplyScalar(cruiseSpeed * 1.4);
              } else if (hovering) {
                  bird.velocity.multiplyScalar(Math.exp(-14 * dt));
                  if (!isAi) bird.flapRate = 0.6;
              } else {
                  let newDir = currentDir.clone();
                  if (distSqToTarget >= 0.1 && toTargetPlanar.lengthSq() > 1e-9) {
                      const dot = Math.max(-1, Math.min(1, currentDir.dot(desiredDir)));
                      if (dot < -0.999) {
                          // Exactly opposite: escape sideways first.
                          newDir.set(-currentDir.y, currentDir.x, 0).normalize();
                      } else {
                          const alpha = 1 - Math.exp(-4.5 * dt);
                          newDir = currentDir.clone().lerp(desiredDir, alpha).normalize();
                          const angle = Math.acos(Math.max(-1, Math.min(1, currentDir.dot(newDir))));
                          // Feather Brake raises the turn cap to 8 rad/s
                          // (Section 2.4); normal flight keeps 5.5.
                          const maxAngle = (brakingNow ? 8 : 5.5) * dt;
                          if (angle > maxAngle && angle > 1e-6) {
                              newDir = currentDir.clone().lerp(newDir, maxAngle / angle).normalize();
                          }
                      }
                  }
                  // Reversal spool (Section 2.1): after a direction
                  // reversal over 90 degrees, speed spools back toward
                  // cruise with about a 120 ms time constant, so
                  // reversals carve a small arc instead of pivoting.
                  // The spool only bites inside reversals; straight
                  // flight and the 1.4 s crossing anchor are untouched.
                  let speedFactor = brakingNow ? 0.35 : 1.0;
                  if (currentDir.dot(desiredDir) < 0 && bird.spoolT < 0) bird.spoolT = 0;
                  if (bird.spoolT >= 0) {
                      bird.spoolT += dt;
                      const spoolFactor = 1 - 0.65 * Math.exp(-bird.spoolT / 0.12);
                      speedFactor *= spoolFactor;
                      if (spoolFactor > 0.995) bird.spoolT = -1;
                  }
                  // Top speed includes speedMult (stat upgrades, boosts).
                  bird.velocity.copy(newDir.multiplyScalar(cruiseSpeed * speedFactor));
                  // Brake presentation: wings spread, flap rate down.
                  if (brakingNow && !isAi) bird.flapRate = Math.min(bird.flapRate, 0.55);
              }
              bird.velocity.z = 0;

              // Delta-time integration: this is the line that makes the
              // crossing time identical on every screen and refresh rate.
              bird.position.add(bird.velocity.clone().multiplyScalar(dt));
              bird.position.z = -15;
          }
        }
        
        // Output screen coords for syncing to physics engine
        const screenPos = bird.position.clone();
        screenPos.project(this.camera);
        const x2d = (screenPos.x * .5 + .5) * window.innerWidth;
        const y2d = (screenPos.y * -.5 + .5) * window.innerHeight;
        
        if (isAi) {
            this.gameState.aiPhoenixScreenPos.set({x: x2d, y: y2d});
        } else {
            this.gameState.phoenixScreenPos.set({x: x2d, y: y2d});
        }

        const lookTarget = bird.position.clone().add(bird.velocity.clone().multiplyScalar(100));
        const dummy = new THREE.Object3D();
        dummy.position.copy(bird.position);
        
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(dummy.position, lookTarget, new THREE.Vector3(0, 1, 0))
        );
        targetQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
        
        if (bird.historyQuat.length > 0) {
            dummy.quaternion.copy(bird.historyQuat[0]).slerp(targetQuat, 1 - Math.pow(1 - 0.075, frameScale));
        } else {
            dummy.quaternion.copy(targetQuat);
        }

        const vDiff = bird.velocity.clone().sub(bird.previousVelocity);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(dummy.quaternion);
        // Velocity is in units per second now (about 60x the old per-frame
        // values at the reference size), so the bank gain drops from 600
        // to 10, normalised by frameScale so the response per second is
        // the same at any refresh rate.
        const bankGain = 10 / Math.max(0.2, Math.min(frameScale, 5));
        let targetBank = vDiff.dot(right) * bankGain;
        targetBank = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, targetBank));

        if (!isAi && this.gameState.isDrilling()) {
            bird.currentBank += 0.5 * frameScale;
        } else {
            bird.currentBank += (targetBank - bird.currentBank) * (1 - Math.pow(1 - 0.025, frameScale));
        }

        // Air Roll visual (spec Section 2.3): one full barrel rotation
        // across the hop, layered over the bank, turning toward the
        // hop direction. The trail corkscrews on its own because the
        // hop really moves the bird sideways through its history.
        const rollMove = isAi ? this.gameState.aiMovement
            : (this.gameState.activeScreen() === 'game' && this.gameState.currentGameMode() === 'ai_vs_ai')
                ? this.gameState.ai2Movement : this.gameState.playerMovement;
        let extraRoll = 0;
        const rollNowMs = Date.now();
        if (rollNowMs < rollMove.rollUntil) {
            const p = 1 - (rollMove.rollUntil - rollNowMs) / STAMINA.rollMs;
            extraRoll = p * Math.PI * 2 * rollMove.rollSide;
        }

        dummy.rotateZ(bird.currentBank + extraRoll);
        bird.previousVelocity.copy(bird.velocity);

        bird.historyPos.unshift(bird.position.clone());
        bird.historyQuat.unshift(dummy.quaternion.clone());
        if (bird.historyPos.length > this.MAX_HISTORY) {
            bird.historyPos.pop(); bird.historyQuat.pop();
        }

        // Silhouette core sprite: rides the head history entry with the
        // same orientation as the particles, sized to about 0.85 times
        // wingspan (spec 2.1), blinking in sync with the particle layers.
        // The plane is anchored by its head, not its centre: the glyph's
        // beak sits just ahead of the bird position (where the particle
        // head rides) and the body and tail plumes extend backward over
        // the particle body, so the sprite and the fill draw one bird
        // instead of a glyph floating ahead of a particle stream.
        if (bird.core) {
            bird.core.position.copy(bird.position);
            if (bird.historyQuat.length > 0) bird.core.quaternion.copy(bird.historyQuat[0]);
            const coreSpan = 8 * this.birdScale * 0.85;
            bird.core.scale.set(coreSpan, coreSpan, coreSpan);
            const coreLen = coreSpan * 1.25;
            const anchorBack = new THREE.Vector3(0, 0, -0.44 * coreLen).applyQuaternion(bird.core.quaternion);
            bird.core.position.add(anchorBack);
            bird.core.visible = bird.group.visible && !(!isAi && this.gameState.isRebirthing());
            if (!isAi && this.visState === 'alive') {
                (bird.core.material as THREE.MeshBasicMaterial).opacity = 0.9 * (bird.particles.material as THREE.PointsMaterial).opacity;
            }
        }

        // Keep the visibility glow centred on the bird, sized to the
        // wingspan (per-skin span, spec 2.4), blinking in step with the
        // particles during i-frames.
        if (bird.glow) {
            bird.glow.position.copy(bird.position);
            const glowSpan = 8 * this.birdScale * bird.glowSpanFactor;
            bird.glow.scale.set(glowSpan, glowSpan, 1);
            bird.glow.visible = bird.group.visible && !(!isAi && this.gameState.isRebirthing());
            if (!isAi) {
                const gm = bird.glow.material as THREE.SpriteMaterial;
                let glowOpacity = 0.5 * (bird.particles.material as THREE.PointsMaterial).opacity;
                if (this.gameState.activeScreen() === 'menu') glowOpacity *= 0.8; // calmer menu glow (spec 2.2)
                if (bird.climbTime > 0.4 && this.gameState.activeScreen() === 'game') glowOpacity *= 1.2; // flap burst glow (spec 2.2)
                gm.opacity = glowOpacity;
            }
        }

        if (!this.gameState.isPaused() && (!this.gameState.isRebirthing() || isAi)) {
            bird.flapTime += 0.04 * frameScale * bird.flapRate;
        }
        const mainPos = bird.particles.geometry.attributes['position'].array as Float32Array;
        const fillPos = bird.fillParticles ? (bird.fillParticles.geometry.attributes['position'].array as Float32Array) : mainPos;

        if (!isAi && this.gameState.isRebirthing()) {
            // Ash state (existing behavior, now across both buffers):
            // points jitter and fall while the rebirth charge runs.
            for (let k = 0; k < bird.phoenixCount; k++) {
                const arr = bird.inFill[k] ? fillPos : mainPos;
                const j = bird.bufferIndex[k] * 3;
                arr[j] += (Math.random() - 0.5) * 0.05;
                arr[j + 1] -= Math.random() * 0.1;
                arr[j + 2] += (Math.random() - 0.5) * 0.05;
            }
        } else {
            const skin = isAi ? HOSTILE_SKIN : phoenixSkinById(bird.skinId);
            const drillingNow = !isAi && this.gameState.isDrilling();
            const speedNow = Math.max(0.001, bird.velocity.length());
            // Body and tail extents in base-position units (the tail
            // sampler tops out at 10, the body sphere at 3.6).
            const zBody = 3.6, zMax = 10;
            const bodySpanWorld = zBody * this.birdScale;
            const tailSpanWorld = (zMax - zBody) * this.birdScale;
            for (let k = 0; k < bird.phoenixCount; k++) {
              const idx = k * 3;
              const baseX = bird.basePositions[idx];
              const baseY = bird.basePositions[idx + 1];
              const baseZ = bird.basePositions[idx + 2];

              const scaledBaseX = baseX * this.birdScale;
              const scaledBaseY = baseY * this.birdScale;
              const scaledBaseZ = baseZ * this.birdScale;

              // History sampling in seconds of flight history (spec
              // 2.3): the body region keeps the historical distance
              // mapping, and the tail region is remapped so the whole
              // visible trail spans TRAIL_SECONDS (0.45 s) at any speed
              // and any refresh rate, instead of stretching with the
              // frame cadence. The drill dash compresses the ribbon
              // spacing to 0.7 so the bird reads as a tightening
              // corkscrew (spec 2.2).
              let trailT: number;
              if (scaledBaseZ <= bodySpanWorld) {
                  trailT = scaledBaseZ / speedNow;
              } else {
                  const tailSeconds = Math.max(0.05, ParticleBgComponent.TRAIL_SECONDS - bodySpanWorld / speedNow);
                  trailT = bodySpanWorld / speedNow + ((scaledBaseZ - bodySpanWorld) / tailSpanWorld) * tailSeconds;
              }
              if (drillingNow) trailT *= 0.7;
              let histIdx = Math.floor(trailT / Math.max(dt, 0.0001));
              histIdx = Math.max(0, Math.min(bird.historyPos.length - 1, histIdx));

              const hPos = bird.historyPos[histIdx];
              const hQuat = bird.historyQuat[histIdx];

              let flapAmount = Math.abs(scaledBaseX) * 0.5;
              // Bank compression (spec 2.2): the inside wing's flap
              // amplitude halves at full bank, so turns read as a
              // bird, not a rotating sticker.
              if (Math.abs(bird.currentBank) > 0.05 && Math.abs(scaledBaseX) > 0.5 * this.birdScale) {
                  const inside = (scaledBaseX > 0) === (bird.currentBank > 0);
                  if (inside) flapAmount *= 1 - 0.5 * Math.min(1, Math.abs(bird.currentBank) / (Math.PI / 2.5));
              }
              const flapPhase = bird.flapTime - scaledBaseZ * 2.0;
              const flapOffset = Math.sin(flapPhase) * flapAmount;

              // Flicker: the outer fringe flickers more than the fill,
              // and the last 20 percent of the tail breaks into
              // detached ember sparks (spec 2.3).
              let flick = 0.05;
              if (bird.pointRegion[k] === 2) flick = 0.09;
              if (scaledBaseZ > bodySpanWorld + 0.8 * tailSpanWorld) flick = 0.15;
              if (bird.pointRegion[k] === 1) flick *= skin.flickerScale;
              const flickerX = (Math.random() - 0.5) * flick * this.birdScale;
              const flickerY = (Math.random() - 0.5) * flick * this.birdScale;

              const localOffset = new THREE.Vector3(scaledBaseX + flickerX, scaledBaseY + flapOffset + flickerY, 0);
              // Skin trail character (spec 2.4): Frost sheds slow
              // sparks that fall instead of streaming; Verdant sheds
              // drifting pollen motes; Celestial fill sparkles twinkle.
              if (scaledBaseZ > bodySpanWorld) {
                  if (skin.trailStyle === 'snow') {
                      localOffset.y -= (scaledBaseZ / (zMax * this.birdScale)) * 0.35 * this.birdScale;
                  } else if (skin.trailStyle === 'pollen') {
                      localOffset.x += Math.sin(bird.flapTime * 0.7 + scaledBaseZ * 1.5) * 0.10 * this.birdScale;
                  }
              }
              if (bird.sparkle[k] && skin.trailStyle === 'sequence') {
                  localOffset.x += Math.sin(Date.now() * 0.005 + k * 1.7) * 0.08 * this.birdScale;
                  localOffset.y += Math.cos(Date.now() * 0.004 + k * 2.3) * 0.08 * this.birdScale;
              }
              localOffset.applyQuaternion(hQuat);

              let finalX = hPos.x + localOffset.x;
              const wrapWidth = this.boundX * 2 + 10;

              if (finalX > wrapWidth / 2) {
                finalX -= wrapWidth;
              } else if (finalX < -wrapWidth / 2) {
                finalX += wrapWidth;
              }

              const arr = bird.inFill[k] ? fillPos : mainPos;
              const j = bird.bufferIndex[k] * 3;
              arr[j] = finalX;
              arr[j + 1] = hPos.y + localOffset.y;
              arr[j + 2] = hPos.z + localOffset.z;
            }
        }
        bird.particles.geometry.attributes['position'].needsUpdate = true;
        if (bird.fillParticles) bird.fillParticles.geometry.attributes['position'].needsUpdate = true;
        
        // Only render cosmetics for player
        if (!isAi) {
            if (this.goldenAuraMesh) {
                this.goldenAuraMesh.visible = this.gameState.hasGoldenAura() && this.gameState.toggleGoldenAura() && !this.gameState.isRebirthing();
                if (this.goldenAuraMesh.visible) {
                    this.goldenAuraMesh.position.copy(bird.position);
                    this.goldenAuraMesh.quaternion.copy(dummy.quaternion);
                    const auraPos = this.goldenAuraMesh.geometry.attributes['position'].array as Float32Array;
                    const auraBase = this.goldenAuraMesh.geometry.attributes['basePosition'].array as Float32Array;
                    const time = Date.now() * 0.002;
                    for (let i = 0; i < auraPos.length / 3; i++) {
                        const bx = auraBase[i*3];
                        const by = auraBase[i*3+1];
                        const bz = auraBase[i*3+2];
                        const angle = time + by * 0.5;
                        const cosA = Math.cos(angle);
                        const sinA = Math.sin(angle);
                        auraPos[i*3] = bx * cosA - bz * sinA;
                        auraPos[i*3+1] = by + Math.sin(time * 2 + i) * 0.5;
                        auraPos[i*3+2] = bx * sinA + bz * cosA;
                    }
                    this.goldenAuraMesh.geometry.attributes['position'].needsUpdate = true;
                }
            }

            if (this.celestialShieldMesh) {
                this.celestialShieldMesh.visible = this.gameState.hasCelestialShield() && this.gameState.toggleCelestialShield() && !this.gameState.isRebirthing();
                if (this.celestialShieldMesh.visible) {
                    const targetPos = (this.celestialShieldMesh as any).targetPos;
                    targetPos.lerp(bird.position, 1 - Math.pow(0.9, frameScale));
                    this.celestialShieldMesh.position.copy(targetPos);
                    this.celestialShieldMesh.rotation.y += 0.01 * frameScale;
                    this.celestialShieldMesh.rotation.x += 0.005 * frameScale;
                    const shieldPos = this.celestialShieldMesh.geometry.attributes['position'].array as Float32Array;
                    const shieldBase = this.celestialShieldMesh.geometry.attributes['basePosition'].array as Float32Array;
                    const pulse = 1 + Math.sin(Date.now() * 0.003) * 0.05;
                    for (let i = 0; i < shieldPos.length; i++) {
                        shieldPos[i] = shieldBase[i] * pulse;
                    }
                    this.celestialShieldMesh.geometry.attributes['position'].needsUpdate = true;
                }
            }

            if (this.cosmicTrailMesh) {
                this.cosmicTrailMesh.visible = this.gameState.hasCosmicTrail() && this.gameState.toggleCosmicTrail() && !this.gameState.isRebirthing();
                if (this.cosmicTrailMesh.visible) {
                    // Shift the trail at a fixed 60 Hz cadence so its
                    // length in seconds does not shrink at 120 Hz.
                    this.trailAccumulator += dt;
                    if (this.trailAccumulator >= 1 / 60) {
                        this.trailAccumulator = 0;
                        const tPos = this.cosmicTrailMesh.geometry.attributes['position'].array as Float32Array;
                        for (let i = tPos.length - 1; i >= 3; i--) {
                            tPos[i] = tPos[i - 3];
                        }
                        const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(dummy.quaternion).multiplyScalar(2);
                        tPos[0] = bird.position.x + backward.x + (Math.random() - 0.5) * 1.5;
                        tPos[1] = bird.position.y + backward.y + (Math.random() - 0.5) * 1.5;
                        tPos[2] = bird.position.z + backward.z + (Math.random() - 0.5) * 1.5;
                        this.cosmicTrailMesh.geometry.attributes['position'].needsUpdate = true;
                    }
                }
            }
        }
      }
  }

  // Enemy types get the shared death burst on removal (Section 3.1);
  // everything else (pickups, projectiles, effects) just disappears.
  private static readonly BURST_TYPES = ['slime', 'bat', 'golem', 'imp', 'wisp', 'pod', 'mite', 'sentry_shard', 'seedmother', 'rift_mine', 'shieldback', 'pyre_moth', 'phantom', 'wraith', 'chanter', 'serpent', 'darter', 'boss'];

  private syncEntities() {
    const nowMs = performance.now();
    const dtSec = this.lastSyncMs ? Math.min(0.1, (nowMs - this.lastSyncMs) / 1000) : 1 / 60;
    this.lastSyncMs = nowMs;

    const active = this.gameState.activeEntities();
    const activeIds = new Set(active.map(e => e.id));

    // Animation budget (visual spec Section 1.4): full vertex
    // animation for the boss and the nearest 6 enemies; every other
    // enemy renders transform-only (mesh position, rotation, scale),
    // which is what keeps a full 12-enemy field inside the frame
    // budget. Distances use last frame's mesh positions against the
    // bird's position; one frame of staleness is invisible here.
    this.fullAnimIds.clear();
    if (this.bird) {
      const bp = this.bird.position;
      const foes: { id: string; d: number; boss: boolean }[] = [];
      for (const e of active) {
        if (!ParticleBgComponent.BURST_TYPES.includes(e.type)) continue;
        const pooled = this.entityPool.get(e.id);
        const d = pooled ? pooled.mesh.position.distanceToSquared(bp) : Number.MAX_SAFE_INTEGER;
        foes.push({ id: e.id, d, boss: e.type === 'boss' });
      }
      foes.sort((a, b) => a.d - b.d);
      for (const f of foes.slice(0, 6)) this.fullAnimIds.add(f.id);
      for (const f of foes) if (f.boss) this.fullAnimIds.add(f.id);
    }

    // Remove dead entities
    for (const [id, entity] of this.entityPool.entries()) {
      if (!activeIds.has(id)) {
        if (ParticleBgComponent.BURST_TYPES.includes(entity.type)) {
          // Death burst: keep the mesh on screen with a snapshot of its
          // animated shape; updateDyingBursts scatters and cools it.
          this.dyingBursts.push({
            mesh: entity.mesh,
            positions: (entity.mesh.geometry.attributes['position'].array as Float32Array).slice(),
            colors: (entity.mesh.geometry.attributes['color'].array as Float32Array).slice(),
            startMs: nowMs,
          });
        } else {
          this.scene.remove(entity.mesh);
          entity.mesh.geometry.dispose();
          (entity.mesh.material as THREE.Material).dispose();
        }
        this.entityPool.delete(id);
      }
    }

    // Add/Update active entities
    for (const data of active) {
      if (data.type === 'enemy_phoenix') continue; // Handled by aiBird
      
      let entity = this.entityPool.get(data.id);
      if (!entity) {
        entity = this.createEntityMesh(data);
        this.scene.add(entity.mesh);
        this.entityPool.set(data.id, entity);
      }

      // Unproject 2D to 3D
      const vec = new THREE.Vector3(
        (data.x / window.innerWidth) * 2 - 1,
        -(data.y / window.innerHeight) * 2 + 1,
        0.5
      );
      vec.unproject(this.camera);
      vec.sub(this.camera.position).normalize();
      const distance = (-15 - this.camera.position.z) / vec.z;
      const pos3d = this.camera.position.clone().add(vec.multiplyScalar(distance));
      
      entity.mesh.position.copy(pos3d);

      // Animation budget state for this frame (Section 1.4): enemies
      // outside the nearest 6 skip per-vertex animation. On the
      // transition into budget mode, restore the built pose once so
      // the frozen frame (and any later death burst snapshot) uses
      // the clean builder shape.
      const budgeted = !!this.bird
        && ParticleBgComponent.BURST_TYPES.includes(data.type)
        && !this.fullAnimIds.has(data.id);
      if (entity.basePositions && budgeted !== !!entity.budgeted) {
        if (budgeted) {
          const attr = entity.mesh.geometry.attributes['position'];
          (attr.array as Float32Array).set(entity.basePositions);
          attr.needsUpdate = true;
        } else {
          // Back to full animation: clear any budget-mode scale pulse.
          entity.mesh.scale.set(1, 1, 1);
        }
        entity.budgeted = budgeted;
      }

      // Rotate for visual effect
      if (data.type === 'coin') {
        entity.mesh.rotation.y += 0.1;
      } else if (data.type === 'heart') {
        const beat = 1 + Math.sin(Date.now() * 0.01) * 0.2;
        entity.mesh.scale.set(beat, beat, beat);
      } else if (data.type === 'gem' || data.type === 'xp_orb' || data.type === 'spark_cell' || data.type === 'overcharge') {
        entity.mesh.rotation.y += 0.05;
        entity.mesh.rotation.x += 0.02;
      }
      
      // Shared damage feedback (visual spec Section 3.1): a health drop
      // since the last frame starts the hit flash (white core pulse,
      // 60 ms; boss phase crossings at 66 and 33 percent run 180 ms).
      if (data.health !== undefined) {
        if (entity.lastHealth !== undefined && data.health < entity.lastHealth) {
          let duration = 60;
          if (data.type === 'boss' && data.maxHealth) {
            const prev = entity.lastHealth / data.maxHealth;
            const cur = data.health / data.maxHealth;
            if ((prev > 0.66 && cur <= 0.66) || (prev > 0.33 && cur <= 0.33)) duration = 180;
          }
          entity.flashStartMs = nowMs;
          entity.flashDurationMs = duration;
          entity.flashActive = true;
        }
        entity.lastHealth = data.health;
      }
      const flashEnv = this.flashEnvelope(entity, nowMs);
      if (entity.flashActive && flashEnv <= 0) {
        // Flash just ended: restore the pristine builder colors.
        if (entity.baseColors) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          (colAttr.array as Float32Array).set(entity.baseColors);
          colAttr.needsUpdate = true;
        }
        entity.flashActive = false;
      }

      // Spawn fade-in for enemies (Section 3.1): a 0.3 s ramp instead of
      // a full-brightness pop. Enemies spawn off screen, so this is
      // mostly felt by boss minions summoned in view.
      if (ParticleBgComponent.BURST_TYPES.includes(data.type) && entity.bornMs !== undefined) {
        const age = (nowMs - entity.bornMs) / 300;
        (entity.mesh.material as THREE.PointsMaterial).opacity = age >= 1 ? 0.9 : 0.9 * Math.max(0, age);
      }

      // Complex Vertex Animations
      if (data.type === 'slime' && entity.basePositions) {
        if (!budgeted) {
        const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
        const time = Date.now() * 0.005 + (entity.timeOffset || 0);
        const squish = Math.sin(time) * 0.3; 
        for(let i=0; i<pPositions.length; i+=3) {
            const baseY = entity.basePositions[i+1];
            pPositions[i+1] = baseY + (baseY > 0 ? baseY * squish : 0);
            pPositions[i] = entity.basePositions[i] * (1 - squish * 0.4); 
            pPositions[i+2] = entity.basePositions[i+2] * (1 - squish * 0.4);
        }
        entity.mesh.geometry.attributes['position'].needsUpdate = true;

        // Ember Glob membrane crawl (Section 3.3): a highlight travels
        // around the membrane so the glob reads as liquid, not a ball.
        // Membrane vertices only; the bright core is layer 1 and is
        // left to the flash pass.
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const crawl = Date.now() * 0.0016 + (entity.timeOffset || 0);
          for (let i = 0; i < entity.layerFlags.length; i++) {
            if (entity.layerFlags[i] === 1) continue;
            const bx = entity.basePositions[i * 3];
            const bz = entity.basePositions[i * 3 + 2];
            const d = Math.cos(Math.atan2(bz, bx) - crawl);
            const boost = d > 0 ? Math.pow(d, 6) * 0.7 : 0;
            const idx = i * 3;
            colArr[idx] = entity.baseColors[idx] * (1 + boost);
            colArr[idx + 1] = entity.baseColors[idx + 1] * (1 + boost);
            colArr[idx + 2] = entity.baseColors[idx + 2] * (1 + boost);
          }
          colAttr.needsUpdate = true;
        }
        } else {
          // Budgeted (Section 1.4): a cheap scale pulse stands in for
          // the vertex squish; positions and the crawl stay frozen.
          const t = Date.now() * 0.005 + (entity.timeOffset || 0);
          const s = 1 + Math.sin(t) * 0.07;
          entity.mesh.scale.set(s, s, s);
        }
      }
      else if (data.type === 'bat' && entity.basePositions) {
        const time = Date.now() * 0.02 + (entity.timeOffset || 0);
        if (!budgeted) {
          const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
          const r = data.size / 30;
          for(let i=0; i<pPositions.length; i+=3) {
              const baseX = entity.basePositions[i];
              const baseY = entity.basePositions[i+1];
              if (Math.abs(baseX) > 0.6 * r) { // Wing vertices
                  const flapOffset = Math.sin(time) * Math.abs(baseX) * 0.8;
                  pPositions[i+1] = baseY + flapOffset;
              } else {
                  pPositions[i+1] = baseY; // Body stays
              }
          }
          entity.mesh.geometry.attributes['position'].needsUpdate = true;
        }
        // Transform-level motion runs in both modes; the banking in
        // particular is the weave read and must never be budgeted away.
        entity.mesh.rotation.y = Math.sin(time * 0.1) * 0.3; // Slight turning
        // Gloomwing banking (Section 3.3): the mesh banks with the weave
        // the steering loop publishes, so the sine path the bat flies
        // reads in its body, not only in its trajectory.
        entity.mesh.rotation.z = -(data.weave || 0) * 0.45;
      }
      else if (data.type === 'golem' && entity.basePositions) {
        const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
        const time = Date.now() * 0.002 + (entity.timeOffset || 0);
        const bob = Math.abs(Math.sin(time * 2)) * 0.2;
        entity.mesh.position.y += bob; // Lumbering walk

        // Bastion Golem telegraph (Section 3.3): the rocks orbit faster
        // as the shot timer charges and the core glows hotter; when the
        // charge wraps, the golem has just fired and the core flashes.
        // The charge is published by the game from the same timer that
        // fires the shot, so the telegraph is synced to the real thing.
        const charge = data.attackCharge ?? 0;
        if (entity.lastCharge !== undefined && entity.lastCharge > 0.7 && charge < entity.lastCharge - 0.5) {
          entity.flashStartMs = nowMs;
          entity.flashDurationMs = 150;
          entity.flashActive = true;
        }
        entity.lastCharge = charge;
        const orbitRate = 2 * (1 + 2.2 * charge * charge); // Shipped base orbit rate is 2 rad/s
        entity.orbitAngle = (entity.orbitAngle || 0) + orbitRate * dtSec;
        const cos = Math.cos(entity.orbitAngle);
        const sin = Math.sin(entity.orbitAngle);

        const r = data.size / 30;
        if (!budgeted) {
          for(let i=0; i<pPositions.length; i+=3) {
              const bx = entity.basePositions[i];
              const bz = entity.basePositions[i+2];
              if (Math.sqrt(bx*bx + bz*bz) > 0.6 * r) { // Orbiting rocks
                  pPositions[i] = bx * cos - bz * sin;
                  pPositions[i+2] = bx * sin + bz * cos;
              }
          }
          entity.mesh.geometry.attributes['position'].needsUpdate = true;
        } else {
          // Budgeted (Section 1.4): the whole mesh turns at the orbit
          // rate instead, so the rocks still circle the core and the
          // charge-up still speeds them visibly.
          entity.mesh.rotation.y += orbitRate * dtSec;
        }

        // Core charge glow, with the flash envelope on top (this branch
        // owns the golem's core colors, so the generic flash pass skips
        // golems).
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const env = this.flashEnvelope(entity, nowMs);
          const brighten = 1 + charge * 0.6;
          for (let i = 0; i < entity.layerFlags.length; i++) {
            if (entity.layerFlags[i] !== 1) continue;
            const idx = i * 3;
            let cr = Math.min(1.6, entity.baseColors[idx] * brighten);
            let cg = Math.min(1.2, entity.baseColors[idx + 1] * brighten);
            let cb = entity.baseColors[idx + 2] * brighten;
            if (env > 0) {
              cr = cr + (1 - cr) * env;
              cg = cg + (1 - cg) * env;
              cb = cb + (1 - cb) * env;
            }
            colArr[idx] = cr; colArr[idx + 1] = cg; colArr[idx + 2] = cb;
          }
          colAttr.needsUpdate = true;
        }
      }
      else if (data.type === 'imp') {
        // Cinder Imp (Section 3.3): across the 0.5 s flare telegraph
        // the body swells to 130 percent and turns white-hot; the
        // charge is published by the game from the same state
        // machine that fires the dash, so the read is the real
        // thing. In the tired drift after a dash the flame dims.
        // Colors are recomputed from the pristine builder colors
        // every frame, like the Golem's charge glow, so no restore
        // bookkeeping is needed; the generic hit flash pass still
        // lands on top during its envelope.
        const charge = data.attackCharge ?? 0;
        const swell = 1 + 0.3 * charge;
        entity.mesh.scale.set(swell, swell, swell);
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const dim = data.state === 'tired' ? 0.5 : 1;
          for (let i = 0; i < entity.layerFlags.length; i++) {
            const idx = i * 3;
            let cr = entity.baseColors[idx] * dim;
            let cg = entity.baseColors[idx + 1] * dim;
            let cb = entity.baseColors[idx + 2] * dim;
            if (entity.layerFlags[i] === 1 && charge > 0) {
              cr = cr + (1 - cr) * charge;
              cg = cg + (1 - cg) * charge;
              cb = cb + (1 - cb) * charge;
            }
            colArr[idx] = cr; colArr[idx + 1] = cg; colArr[idx + 2] = cb;
          }
          colAttr.needsUpdate = true;
        }
      }
      else if (data.type === 'wisp' && entity.basePositions) {
        // Aether Wisp (Section 3.3): the broken ring rotates slowly,
        // so the 60 degree gap travels and the hollow center stays
        // the read. The bright core sits at the center, where
        // rotation is a no-op, so one rotation covers the whole body.
        if (!budgeted) {
          entity.mesh.rotation.z = 0;
          const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
          const ang = Date.now() * 0.0008 + (entity.timeOffset || 0);
          const cos = Math.cos(ang), sin = Math.sin(ang);
          for (let i = 0; i < pPositions.length; i += 3) {
            const bx = entity.basePositions[i];
            const by = entity.basePositions[i + 1];
            pPositions[i] = bx * cos - by * sin;
            pPositions[i + 1] = bx * sin + by * cos;
            pPositions[i + 2] = entity.basePositions[i + 2];
          }
          entity.mesh.geometry.attributes['position'].needsUpdate = true;
        } else {
          entity.mesh.rotation.z -= 0.8 * dtSec;
        }
      }
      else if (data.type === 'pod' && entity.basePositions) {
        if (!budgeted) {
          // Brood Pod (Section 3.3): as the Pod takes damage its
          // surface thins, cells collapsing inward in index order
          // (indices interleave across cells, so the thinning is
          // even over the whole body), and a highlight crawl keeps
          // the surface alive like the Glob's membrane.
          const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
          const total = entity.layerFlags ? entity.layerFlags.length : 1;
          const hf = data.maxHealth ? Math.max(0, Math.min(1, (data.health ?? data.maxHealth) / data.maxHealth)) : 1;
          // Heart Pod (Blood Moon): the whole body rides the
          // heartbeat scale on top of the thinning.
          const beat = this.gameState.selectedWorldIndex() === 8 ? this.heartBeatScale(entity.timeOffset || 0) : 1;
          for (let i = 0; i < pPositions.length; i += 3) {
            const frac = (i / 3) / total;
            const s = (frac > hf ? 0.15 : 1) * beat;
            pPositions[i] = entity.basePositions[i] * s;
            pPositions[i + 1] = entity.basePositions[i + 1] * s;
            pPositions[i + 2] = entity.basePositions[i + 2] * s;
          }
          entity.mesh.geometry.attributes['position'].needsUpdate = true;
          if (entity.baseColors && entity.layerFlags) {
            const colAttr = entity.mesh.geometry.attributes['color'];
            const colArr = colAttr.array as Float32Array;
            const crawl = Date.now() * 0.0013 + (entity.timeOffset || 0);
            for (let i = 0; i < entity.layerFlags.length; i++) {
              if (entity.layerFlags[i] === 1) continue;
              const bx = entity.basePositions[i * 3];
              const bz = entity.basePositions[i * 3 + 2];
              const d = Math.cos(Math.atan2(bz, bx) - crawl);
              const boost = d > 0 ? Math.pow(d, 6) * 0.7 : 0;
              const idx = i * 3;
              colArr[idx] = entity.baseColors[idx] * (1 + boost);
              colArr[idx + 1] = entity.baseColors[idx + 1] * (1 + boost);
              colArr[idx + 2] = entity.baseColors[idx + 2] * (1 + boost);
            }
            colAttr.needsUpdate = true;
          }
        } else {
          // Budgeted path: a gentle breathing pulse, or the
          // Heart Pod's heartbeat in Blood Moon.
          const s = this.gameState.selectedWorldIndex() === 8
            ? this.heartBeatScale(entity.timeOffset || 0)
            : 1 + Math.sin(Date.now() * 0.004 + (entity.timeOffset || 0)) * 0.05;
          entity.mesh.scale.set(s, s, s);
        }
      }
      else if (data.type === 'mite' && entity.basePositions) {
        // Mite (Section 3.3): the single wing pair flaps fast, the
        // Gloomwing's motion at swarmer tempo.
        if (!budgeted) {
          const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
          const time = Date.now() * 0.03 + (entity.timeOffset || 0);
          const r = data.size / 30;
          for (let i = 0; i < pPositions.length; i += 3) {
            const baseX = entity.basePositions[i];
            const baseY = entity.basePositions[i + 1];
            if (Math.abs(baseX) > 0.5 * r) {
              pPositions[i + 1] = baseY + Math.sin(time) * Math.abs(baseX) * 0.9;
            } else {
              pPositions[i + 1] = baseY;
            }
          }
          entity.mesh.geometry.attributes['position'].needsUpdate = true;
        } else {
          const s = 1 + Math.sin(Date.now() * 0.03 + (entity.timeOffset || 0)) * 0.1;
          entity.mesh.scale.set(s, s, s);
        }
      }
      else if (data.type === 'sentry_shard') {
        // Sentry Shard (Stage 4): the octahedron's long axis turns
        // to track the player (the published facing), and the core
        // eye brightens through the 0.4 s charge before each shot,
        // the same telegraph contract as the Golem's orbit. Colors
        // are recomputed from the pristine builder colors each
        // frame, like the Imp's.
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        entity.mesh.rotation.y += 0.15 * dtSec;
        const charge = data.attackCharge ?? 0;
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const brighten = 1 + charge * 1.1;
          for (let i = 0; i < entity.layerFlags.length; i++) {
            if (entity.layerFlags[i] !== 1) continue;
            const idx = i * 3;
            colArr[idx] = Math.min(1.6, entity.baseColors[idx] * brighten);
            colArr[idx + 1] = Math.min(1.6, entity.baseColors[idx + 1] * brighten);
            colArr[idx + 2] = Math.min(1.6, entity.baseColors[idx + 2] * brighten);
          }
          colAttr.needsUpdate = true;
        }
      }
      else if (data.type === 'seedmother') {
        // Seedmother (Stage 4): a gentle bob and breathing pulse;
        // the dome is a presence, not a threat display.
        const t = Date.now() * 0.0011 + (entity.timeOffset || 0);
        entity.mesh.position.y += Math.sin(t) * 0.12;
        const s = 1 + Math.sin(t * 1.7) * 0.03;
        entity.mesh.scale.set(s, s, s);
      }
      else if (data.type === 'rift_mine') {
        // Rift Mine (Stage 4): the hostile core blinks, and the
        // blink rate doubles while a player is inside the trigger
        // radius (the published attackCharge is 1 exactly then).
        // That rate change is the proximity telegraph.
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const armed = (data.attackCharge ?? 0) > 0;
          const rate = armed ? 0.022 : 0.011;
          const blink = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(Date.now() * rate + (entity.timeOffset || 0)));
          for (let i = 0; i < entity.layerFlags.length; i++) {
            if (entity.layerFlags[i] !== 1) continue;
            const idx = i * 3;
            colArr[idx] = entity.baseColors[idx] * blink;
            colArr[idx + 1] = entity.baseColors[idx + 1] * blink;
            colArr[idx + 2] = entity.baseColors[idx + 2] * blink;
          }
          colAttr.needsUpdate = true;
        }
      }
      else if (data.type === 'shieldback') {
        // Shieldback (Stage 4): the shield face turns toward the
        // player (published facing), and while a reduced frontal
        // hit's spark window is open the rim ring flashes white.
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        const sparking = !!data.sparkUntil && Date.now() < data.sparkUntil;
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          if (sparking) {
            entity.wasSparking = true;
            for (let i = 0; i < entity.layerFlags.length; i++) {
              if (entity.layerFlags[i] !== 1) continue;
              const idx = i * 3;
              colArr[idx] = 1.6; colArr[idx + 1] = 1.6; colArr[idx + 2] = 1.6;
            }
            colAttr.needsUpdate = true;
          } else if (entity.wasSparking) {
            entity.wasSparking = false;
            for (let i = 0; i < entity.layerFlags.length; i++) {
              if (entity.layerFlags[i] !== 1) continue;
              const idx = i * 3;
              colArr[idx] = entity.baseColors[idx];
              colArr[idx + 1] = entity.baseColors[idx + 1];
              colArr[idx + 2] = entity.baseColors[idx + 2];
            }
            colAttr.needsUpdate = true;
          }
        }
      }
      else if (data.type === 'pyre_moth' && entity.basePositions) {
        // Pyre Moth (Stage 4): the two big wings flap slowly (the
        // Mite's motion at burster tempo). While fusing, the whole
        // body strobes faster and hotter as the fuse burns down;
        // the strobe is the detonation warning and overrides the
        // resting colors for its 0.6 s.
        if (!budgeted) {
          const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
          const time = Date.now() * 0.006 + (entity.timeOffset || 0);
          const r = data.size / 30;
          for (let i = 0; i < pPositions.length; i += 3) {
            const baseX = entity.basePositions[i];
            const baseY = entity.basePositions[i + 1];
            if (Math.abs(baseX) > 0.5 * r) {
              pPositions[i + 1] = baseY + Math.sin(time) * Math.abs(baseX) * 0.35;
            } else {
              pPositions[i + 1] = baseY;
            }
          }
          entity.mesh.geometry.attributes['position'].needsUpdate = true;
        }
        const fusing = data.state === 'fusing';
        if (entity.baseColors) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          if (fusing) {
            entity.wasFusing = true;
            const charge = data.attackCharge ?? 0;
            const strobe = 1 + charge * (0.7 + 0.7 * Math.sin(Date.now() * 0.05));
            for (let i = 0; i < colArr.length; i++) {
              colArr[i] = Math.min(1.8, entity.baseColors[i] * strobe);
            }
            colAttr.needsUpdate = true;
          } else if (entity.wasFusing) {
            entity.wasFusing = false;
            colArr.set(entity.baseColors);
            colAttr.needsUpdate = true;
          }
        }
      }
      else if (data.type === 'phantom') {
        // Shroud Phantom (Stage 5): opacity IS the phase read.
        // Solid is the standard 0.9; phased drops to a quarter, so
        // the shape is a rumor; through the reappear the shimmer
        // climbs back with the published charge (the 0.7 s
        // telegraph window the player learns to watch).
        const mat = entity.mesh.material as THREE.PointsMaterial;
        if (data.state === 'phased') mat.opacity = 0.25;
        else if (data.state === 'reappear') mat.opacity = 0.25 + 0.65 * (data.attackCharge ?? 0);
        else mat.opacity = 0.9;
        entity.mesh.rotation.y += 0.3 * dtSec;
      }
      else if (data.type === 'wraith') {
        // Lance Wraith (Stage 5): the spear body aligns to its aim
        // line (published facing), and the aiming eye brightens
        // through the lock with the published charge, the Sentry
        // Shard's telegraph pattern.
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        const charge = data.attackCharge ?? 0;
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const brighten = 1 + charge * 1.3;
          for (let i = 0; i < entity.layerFlags.length; i++) {
            if (entity.layerFlags[i] !== 1) continue;
            const idx = i * 3;
            colArr[idx] = Math.min(1.8, entity.baseColors[idx] * brighten);
            colArr[idx + 1] = Math.min(1.8, entity.baseColors[idx + 1] * brighten);
            colArr[idx + 2] = Math.min(1.8, entity.baseColors[idx + 2] * brighten);
          }
          colAttr.needsUpdate = true;
        }
      }
      else if (data.type === 'wraith_line') {
        // The lock-on line (Stage 5): a thin hostile sprite from the
        // wraith's eye to the player's position, brightening as the
        // lock completes. This branch owns its opacity every frame.
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        (entity.mesh.material as THREE.PointsMaterial).opacity = 0.3 + 0.65 * (data.attackCharge ?? 0);
      }
      else if (data.type === 'chanter') {
        // War Chanter (Stage 5): the note-spark ring orbits by
        // turning the whole mesh slowly; the bell itself is
        // rotationally symmetric, so only the ring reads as moving.
        // A gentle breathing scale keeps the bell alive.
        entity.mesh.rotation.z += 0.9 * dtSec;
        const s = 1 + Math.sin(Date.now() * 0.002 + (entity.timeOffset || 0)) * 0.02;
        entity.mesh.scale.set(s, s, s);
      }
      else if (data.type === 'chanter_pulse') {
        // The buff pulse ring (Stage 5) fades as it expands; the
        // game grows the published size across the buff radius.
        (entity.mesh.material as THREE.PointsMaterial).opacity = 0.85 * (1 - (data.attackCharge ?? 0));
      }
      else if (data.type === 'serpent') {
        // Loom Serpent head (Stage 5): faces its travel direction;
        // through the coil the head swells with the published
        // charge (the 0.5 s lunge telegraph).
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        if (data.state === 'coil') {
          const s = 1 + 0.35 * (data.attackCharge ?? 0);
          entity.mesh.scale.set(s, s, s);
        } else {
          entity.mesh.scale.set(1, 1, 1);
        }
      }
      else if (data.type === 'darter') {
        // Storm Darter (Stage 5): aligned to its travel direction
        // (published facing); the wingtip sparks flare through the
        // line-up with the published charge, so the pass is
        // announced before it starts.
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        const charge = data.attackCharge ?? 0;
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const brighten = 1 + charge * 1.2;
          for (let i = 0; i < entity.layerFlags.length; i++) {
            if (entity.layerFlags[i] !== 1) continue;
            const idx = i * 3;
            colArr[idx] = Math.min(1.8, entity.baseColors[idx] * brighten);
            colArr[idx + 1] = Math.min(1.8, entity.baseColors[idx + 1] * brighten);
            colArr[idx + 2] = Math.min(1.8, entity.baseColors[idx + 2] * brighten);
          }
          colAttr.needsUpdate = true;
        }
      }
      else if (data.type === 'boss' && entity.basePositions) {
        const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
        const time = Date.now() * 0.005 + (entity.timeOffset || 0);
        const jawOpen = (Math.sin(time * 0.5) * 0.5 + 0.5) * 0.3 * (data.size/30);
        
        for(let i=0; i<pPositions.length; i+=3) {
            const baseY = entity.basePositions[i+1];
            if (baseY < 0) { // Jaw drops
                pPositions[i+1] = baseY - jawOpen;
            } else {
                pPositions[i+1] = baseY;
            }
        }
        entity.mesh.geometry.attributes['position'].needsUpdate = true;
        entity.mesh.rotation.y -= 0.02; // Slow ominous spin
        entity.mesh.rotation.z = Math.sin(time * 0.2) * 0.1; // Float wobble
      }
      else if (data.type === 'fire') {
        entity.mesh.scale.multiplyScalar(0.96); // Shrink over time
        entity.mesh.rotation.y += 0.1;
      } else if (data.type === 'egg' && entity.basePositions) {
        const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
        const time = Date.now() * 0.003 + (entity.timeOffset || 0);
        entity.mesh.rotation.y = time * 0.5;
        entity.mesh.rotation.z = time * 0.2;
        
        for(let i=0; i<pPositions.length; i+=3) {
            const baseX = entity.basePositions[i];
            const baseY = entity.basePositions[i+1];
            const baseZ = entity.basePositions[i+2];
            const dist = Math.sqrt(baseX*baseX + baseY*baseY + baseZ*baseZ);
            
            // Pulsate outer vortex shell
            if (dist > 15) {
                const pulse = 1 + Math.sin(time * 3 + dist) * 0.1;
                pPositions[i] = baseX * pulse;
                pPositions[i+1] = baseY * pulse;
                pPositions[i+2] = baseZ * pulse;
            }
        }
        entity.mesh.geometry.attributes['position'].needsUpdate = true;
      } else if (data.type === 'turret' || data.type === 'enemy_phoenix') {
        // True vertex-level flapping animation just like the main phoenix
        if (this.bird && this.bird.basePositions) {
            const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
            const r = data.size / 30;
            const scaleFactor = data.type === 'enemy_phoenix' ? 1.0 : 0.4;
            for (let i = 0; i < 4000; i++) {
                 const idx = i * 3;
                 if (this.bird.basePositions.length > idx + 2) {
                     const baseX = this.bird.basePositions[idx];
                     const baseY = this.bird.basePositions[idx+1];
                     const baseZ = this.bird.basePositions[idx+2];
                     
                     const flapAmount = Math.abs(baseX) * 0.5;
                     const flapPhase = (Date.now() * 0.01) - baseZ * 2.0;
                     const flapOffset = Math.sin(flapPhase) * flapAmount;
                     
                     pPositions[idx] = baseX * scaleFactor * r;
                     pPositions[idx+1] = (baseY + flapOffset) * scaleFactor * r;
                     pPositions[idx+2] = baseZ * scaleFactor * r;
                 }
            }
            entity.mesh.geometry.attributes['position'].needsUpdate = true;
            if (data.type === 'enemy_phoenix') {
                entity.mesh.rotation.y = Math.PI; // Face the screen
            }
        }
      } else if (data.type !== 'egg') {  entity.mesh.rotation.y += 0.02;
      }

      // Hit flash pass: pulse the core layer toward white for the
      // flash envelope. Golems are skipped: their branch above writes
      // core colors itself (charge glow) with the same envelope.
      if (flashEnv > 0 && data.type !== 'golem' && entity.baseColors && entity.layerFlags) {
        const colAttr = entity.mesh.geometry.attributes['color'];
        const colArr = colAttr.array as Float32Array;
        for (let i = 0; i < entity.layerFlags.length; i++) {
          if (entity.layerFlags[i] !== 1) continue;
          const idx = i * 3;
          colArr[idx] = entity.baseColors[idx] + (1 - entity.baseColors[idx]) * flashEnv;
          colArr[idx + 1] = entity.baseColors[idx + 1] + (1 - entity.baseColors[idx + 1]) * flashEnv;
          colArr[idx + 2] = entity.baseColors[idx + 2] + (1 - entity.baseColors[idx + 2]) * flashEnv;
        }
        colAttr.needsUpdate = true;
      }

      // War Chanter buff wash (Stage 5): while the game publishes
      // the buffed flag, this entity's material tint shifts toward
      // the hostile color, so a sped-up enemy is visibly a buffed
      // enemy (design sheet 15). A material tint, not a vertex
      // rewrite: it composes with every per-type color branch.
      const pubMat = entity.mesh.material as THREE.PointsMaterial;
      if (data.buffed) {
        pubMat.color.setRGB(1.35, 0.55, 0.75);
      } else if (pubMat.color.r !== 1 || pubMat.color.g !== 1 || pubMat.color.b !== 1) {
        pubMat.color.setRGB(1, 1, 1);
      }

      // Make aura expand dynamically
      if (data.type === 'aura') {
        entity.mesh.rotation.z += 0.1;
      }
    }

    this.updateDyingBursts(nowMs);
  }

  private flashEnvelope(entity: ParticleEntity, nowMs: number): number {
    if (!entity.flashStartMs) return 0;
    const p = (nowMs - entity.flashStartMs) / (entity.flashDurationMs || 60);
    return p >= 1 ? 0 : 1 - p;
  }

  // Death bursts (Section 3.1): points scatter outward from the shape
  // they died in and cool toward dark ember over 0.4 s, then dispose.
  private updateDyingBursts(nowMs: number) {
    for (let i = this.dyingBursts.length - 1; i >= 0; i--) {
      const burst = this.dyingBursts[i];
      const p = (nowMs - burst.startMs) / 400;
      if (p >= 1) {
        this.scene.remove(burst.mesh);
        burst.mesh.geometry.dispose();
        (burst.mesh.material as THREE.Material).dispose();
        this.dyingBursts.splice(i, 1);
        continue;
      }
      const posAttr = burst.mesh.geometry.attributes['position'];
      const posArr = posAttr.array as Float32Array;
      const scatter = p * p * 1.5;
      for (let v = 0; v < posArr.length; v += 3) {
        const bx = burst.positions[v];
        const by = burst.positions[v + 1];
        const bz = burst.positions[v + 2];
        const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
        posArr[v] = bx + (bx / len) * scatter;
        posArr[v + 1] = by + (by / len) * scatter + p * 0.4;
        posArr[v + 2] = bz + (bz / len) * scatter;
      }
      posAttr.needsUpdate = true;
      const colAttr = burst.mesh.geometry.attributes['color'];
      const colArr = colAttr.array as Float32Array;
      for (let v = 0; v < colArr.length; v += 3) {
        colArr[v] = burst.colors[v] * (1 - p) + 0.25 * p;
        colArr[v + 1] = burst.colors[v + 1] * (1 - p) + 0.06 * p;
        colArr[v + 2] = burst.colors[v + 2] * (1 - p) + 0.02 * p;
      }
      colAttr.needsUpdate = true;
      (burst.mesh.material as THREE.PointsMaterial).opacity = 0.9 * (1 - p);
    }
  }

  // Mesh construction delegates to the shared entity builder
  // (entity-builder.ts, visual spec Section 3.1): one definition per
  // type serves the game and the codex. The hostile color is read from
  // the current world's theme data, so enemy fire is data-driven.
  private createEntityMesh(data: PhysicsEntity): ParticleEntity {
    const world = WORLDS[this.gameState.selectedWorldIndex()];
    const hostile = world?.themeData?.palette?.hostile ?? HOSTILE_RGB;
    const built = buildEntityGeometry(data.type, {
      r: data.size / 30, // Scale factor, as shipped
      hostile,
      ownerId: data.ownerId,
      owner: (data as any).owner,
      gameMode: this.gameState.currentGameMode(),
      worldIndex: this.gameState.selectedWorldIndex(),
      bird: this.bird ? { basePositions: this.bird.basePositions, colorAt: (i: number) => this.birdColorAt(this.bird, i) } : null,
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(built.colors, 3));

    const material = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Points(geo, material);
    mesh.frustumCulled = false;

    return {
      mesh,
      type: data.type,
      // Store base positions for complex entities to allow vertex
      // animation (a copy: the live attribute is rewritten per frame).
      basePositions: built.animated ? built.positions.slice() : undefined,
      // MUST be a copy, not the attribute's own array: the per-frame
      // color writers (Glob crawl, Golem charge glow, hit flash) all
      // compute from baseColors and write into the live attribute.
      // When the two were the same array, every write compounded on
      // the last frame's output and the Glob membrane blew out to
      // white within seconds (found by the Stage 2 harness: codex
      // previews, which have no per-frame writers, rendered the same
      // builder data correctly).
      baseColors: built.colors.slice(),
      layerFlags: built.layer,
      timeOffset: Math.random() * 1000,
      lastHealth: data.health,
      flashStartMs: 0,
      flashDurationMs: 60,
      flashActive: false,
      orbitAngle: Math.random() * Math.PI * 2,
      lastCharge: 0,
      bornMs: performance.now(),
    };
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateBounds();
  }
}
