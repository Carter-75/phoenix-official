import { Component, ElementRef, OnInit, OnDestroy, ViewChild, NgZone, effect, inject } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { WORLDS } from '../../constants/game.constants';
import { PhysicsEntity } from '../../models/game.models';
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
  wasDrilling: boolean;
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

// Canonical phoenix outline in normalized bird space: nx is the wing
// axis (-1..1), nz is the body axis (0 at the head, 1 at the tail tip).
// One outline for every skin: it drives both the inner-fill particle
// sampling and the core sprite glyph, so the two layers always agree.
// Right half from the head, clockwise; the full outline mirrors it.
const GLYPH_HALF: Array<[number, number]> = [
  [0.0, 0.0], [0.06, 0.02], [0.10, 0.08], [0.22, 0.13], [0.60, 0.15],
  [1.0, 0.24], [0.82, 0.40], [0.64, 0.33], [0.50, 0.44], [0.36, 0.38],
  [0.27, 0.46], [0.16, 0.55], [0.15, 0.68], [0.12, 0.97], [0.06, 0.80],
  [0.035, 1.0], [0.0, 0.84],
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
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private particles!: THREE.Points;
  private lavaFlowsGroup!: THREE.Group;
  private bgGlow!: THREE.Mesh;
  private sideArtGroup!: THREE.Group;
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
  private lastFrameTime = 0;
  private trailAccumulator = 0;
  private glowTexture: THREE.Texture | null = null;

  private mouseTarget = new THREE.Vector3(0, -10, -15);
  private entityPool = new Map<string, ParticleEntity>();
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
    effect(() => {
      const worldIndex = this.gameState.selectedWorldIndex();
      const theme = WORLDS[worldIndex].theme;
      this.updateColors(theme);
    });
    effect(() => {
      const skinId = this.gameState.selectedSkinId();
      if (this.bird) this.applySkin(phoenixSkinById(skinId));
    });
  }
  
  ngOnInit() {
    this.initThree();
    this.createParticles();
    this.createCosmetics();
    
    this.bird = this.createBirdState('orange');
    this.initHistory(this.bird);
    this.createPhoenixMesh(this.bird, phoenixSkinById(this.gameState.selectedSkinId()));

    this.aiBird = this.createBirdState('crimson'); // Different theme for AI
    this.initHistory(this.aiBird);
    this.createPhoenixMesh(this.aiBird, HOSTILE_SKIN);
    
    this.updateColors(WORLDS[this.gameState.selectedWorldIndex()].theme);

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
    // equipped skin shares the world's hue family, the ambient field's
    // mid band shifts one step toward its deep band so the player bird
    // stays the brightest object (rule 1.2.1). The bird itself is not
    // recolored by the world: skins override the world palette for the
    // bird only.
    const skin = phoenixSkinById(this.gameState.selectedSkinId());
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

  private onMouseMove(event: MouseEvent) {
    if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen()) return;
    this.updateMouseTarget(event.clientX, event.clientY);
  }

  private onTouchMove(event: TouchEvent) {
    if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen()) return;
    if (event.touches.length > 0) {
      // Prevent the WebView from scrolling / rubber-banding while the finger drives the Phoenix,
      // but only during gameplay so menu UI (buttons, scroll) still works.
      if (this.gameState.activeScreen() === 'game' && event.cancelable) event.preventDefault();
      this.updateMouseTarget(event.touches[0].clientX, event.touches[0].clientY);
    }
  }

  private updateMouseTarget(x: number, y: number) {
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
      skinId: 'ember', flapRate: 1, climbTime: 0, wasDrilling: false, flashUntil: 0, reformUntil: 0, glowSpanFactor: 1.35,
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
  // bounding box for every skin.
  private glyphTexture(skin: PhoenixSkin): THREE.Texture {
    const cached = this.glyphTextures.get(skin.id);
    if (cached) return cached;
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    const px = (nx: number) => S / 2 + nx * (S * 0.46);
    const py = (nz: number) => 8 + nz * (S - 16);
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
    const grad = ctx.createRadialGradient(S / 2, S * 0.36, 6, S / 2, S * 0.42, S * 0.88);
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
    if (skin.glyph.darkHeart) {
      // Eclipse: a dark heart under a bright rim and core (spec 2.4).
      const dg = ctx.createRadialGradient(S / 2, S * 0.40, 4, S / 2, S * 0.40, S * 0.30);
      dg.addColorStop(0, 'rgba(10,4,24,0.88)');
      dg.addColorStop(1, 'rgba(10,4,24,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = `rgba(${Math.round(skin.bright[0] * 255)},${Math.round(skin.bright[1] * 255)},${Math.round(skin.bright[2] * 255)},0.95)`;
      ctx.beginPath(); ctx.arc(S / 2, S * 0.30, 5, 0, Math.PI * 2); ctx.fill();
    }
    if (skin.glyph.facets) {
      // Frost: faint facet lines, like light through ice.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(S * (0.15 + i * 0.11), S * 0.08);
        ctx.lineTo(S * (0.30 + i * 0.09), S * 0.55);
        ctx.stroke();
      }
    }
    if (skin.glyph.sparkles) {
      // Celestial: a sparse star-sparkle subset inside the fill.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      for (let i = 0; i < 26; i++) {
        const x = S * (0.2 + rnd() * 0.6), y = S * (0.1 + rnd() * 0.8), r = 1 + rnd() * 1.8;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    // Bright rim, strongest on Eclipse (its readability carrier).
    ctx.strokeStyle = `rgba(${Math.round(skin.bright[0] * 255)},${Math.round(skin.bright[1] * 255)},${Math.round(skin.bright[2] * 255)},${skin.glyph.darkHeart ? 0.95 : 0.45})`;
    ctx.lineWidth = skin.glyph.darkHeart ? 3 : 1.5;
    ctx.stroke(path);
    // Crest treatment at the head (canvas top centre).
    ctx.fillStyle = `rgb(${Math.round(skin.bright[0] * 255)},${Math.round(skin.bright[1] * 255)},${Math.round(skin.bright[2] * 255)})`;
    const hx = S / 2, hy = py(0.02);
    const tri = (dx: number, h: number, w: number) => {
      ctx.beginPath();
      ctx.moveTo(hx + dx - w, hy + 4); ctx.lineTo(hx + dx, hy - h); ctx.lineTo(hx + dx + w, hy + 4);
      ctx.closePath(); ctx.fill();
    };
    if (skin.glyph.crest === 'tuft') { ctx.beginPath(); ctx.arc(hx, hy - 4, 5, 0, Math.PI * 2); ctx.fill(); }
    else if (skin.glyph.crest === 'spikes') { tri(-7, 15, 3); tri(0, 19, 3); tri(7, 15, 3); }
    else if (skin.glyph.crest === 'rays') { for (let i = -2; i <= 2; i++) tri(i * 7, 20 - Math.abs(i) * 3, 2.5); }
    else if (skin.glyph.crest === 'crown') { tri(-8, 13, 4); tri(0, 18, 4); tri(8, 13, 4); }
    else if (skin.glyph.crest === 'swept') {
      ctx.beginPath(); ctx.moveTo(hx - 3, hy + 5); ctx.lineTo(hx - 20, hy - 12); ctx.lineTo(hx - 6, hy - 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx + 3, hy + 5); ctx.lineTo(hx + 20, hy - 12); ctx.lineTo(hx + 6, hy - 2); ctx.closePath(); ctx.fill();
    } else if (skin.glyph.crest === 'leaf') {
      ctx.beginPath(); ctx.ellipse(hx, hy - 8, 4, 10, 0.3, 0, Math.PI * 2); ctx.fill();
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
    const count = 7000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * this.ambientBoxSize;
      positions[i+1] = (Math.random() - 0.5) * this.ambientBoxSize;
      if (i < 5000 * 3) positions[i+2] = (Math.random() - 0.5) * 40 - 10;
      else positions[i+2] = Math.random() * 8 - 4;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
    // half-turn), its width to the wing axis. Oriented per frame from
    // the head history quaternion, like the particles.
    const coreGeo = new THREE.PlaneGeometry(1, 1);
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

        // Ambient particles moving downward (1.8 units per second)
        const positions = this.particles.geometry.attributes['position'].array as Float32Array;
        const halfBox = this.ambientBoxSize / 2;
        for (let i = 0; i < positions.length; i += 3) {
          positions[i+1] -= 1.8 * dt;
          if (positions[i+1] < -halfBox) { positions[i+1] = halfBox; positions[i] = (Math.random() - 0.5) * this.ambientBoxSize; }
        }
        this.particles.geometry.attributes['position'].needsUpdate = true;
        this.particles.rotation.y += 0.006 * dt;

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
                      speedMult = this.gameState.ai2PhoenixSpeed();
                  } else {
                      speedMult = this.gameState.currentStats().speed;
                      if (Date.now() < this.gameState.speedBoostUntil) speedMult *= 2.0;
                      if (this.gameState.isDrilling()) {
                          const modifiers = this.gameState.currentStats().unlockedAbilities['drill_attack']?.modifiers;
                          if (modifiers && modifiers['speed']) speedMult *= modifiers['speed'];
                      }
                  }
              } else {
                  speedMult = this.gameState.aiPhoenixSpeed(); 
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
              let newDir = currentDir.clone();
              if (distSqToTarget >= 0.1 && toTargetPlanar.lengthSq() > 1e-9) {
                  const desiredDir = toTargetPlanar.normalize();
                  const dot = Math.max(-1, Math.min(1, currentDir.dot(desiredDir)));
                  if (dot < -0.999) {
                      // Exactly opposite: escape sideways first.
                      newDir.set(-currentDir.y, currentDir.x, 0).normalize();
                  } else {
                      const alpha = 1 - Math.exp(-4.5 * dt);
                      newDir = currentDir.clone().lerp(desiredDir, alpha).normalize();
                      const angle = Math.acos(Math.max(-1, Math.min(1, currentDir.dot(newDir))));
                      const maxAngle = 5.5 * dt;
                      if (angle > maxAngle && angle > 1e-6) {
                          newDir = currentDir.clone().lerp(newDir, maxAngle / angle).normalize();
                      }
                  }
              }
              // Top speed includes speedMult (stat upgrades, boosts).
              bird.velocity.copy(newDir.multiplyScalar(cruiseSpeed));
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
        
        dummy.rotateZ(bird.currentBank);
        bird.previousVelocity.copy(bird.velocity);

        bird.historyPos.unshift(bird.position.clone());
        bird.historyQuat.unshift(dummy.quaternion.clone());
        if (bird.historyPos.length > this.MAX_HISTORY) {
            bird.historyPos.pop(); bird.historyQuat.pop();
        }

        // Silhouette core sprite: rides the head history entry with the
        // same orientation as the particles, sized to about 0.85 times
        // wingspan (spec 2.1), blinking in sync with the particle layers.
        if (bird.core) {
            bird.core.position.copy(bird.position);
            if (bird.historyQuat.length > 0) bird.core.quaternion.copy(bird.historyQuat[0]);
            const coreSpan = 8 * this.birdScale * 0.85;
            bird.core.scale.set(coreSpan, coreSpan, coreSpan);
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

  private syncEntities() {
    const active = this.gameState.activeEntities();
    const activeIds = new Set(active.map(e => e.id));

    // Remove dead entities
    for (const [id, entity] of this.entityPool.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(entity.mesh);
        entity.mesh.geometry.dispose();
        (entity.mesh.material as THREE.Material).dispose();
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
      
      // Rotate for visual effect
      if (data.type === 'coin') {
        entity.mesh.rotation.y += 0.1;
      } else if (data.type === 'heart') {
        const beat = 1 + Math.sin(Date.now() * 0.01) * 0.2;
        entity.mesh.scale.set(beat, beat, beat);
      } else if (data.type === 'gem' || data.type === 'xp_orb') {
        entity.mesh.rotation.y += 0.05;
        entity.mesh.rotation.x += 0.02;
      }
      
      // Complex Vertex Animations
      if (data.type === 'slime' && entity.basePositions) {
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
      }
      else if (data.type === 'bat' && entity.basePositions) {
        const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
        const time = Date.now() * 0.02 + (entity.timeOffset || 0);
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
        entity.mesh.rotation.y = Math.sin(time * 0.1) * 0.3; // Slight turning
      }
      else if (data.type === 'golem' && entity.basePositions) {
        const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
        const time = Date.now() * 0.002 + (entity.timeOffset || 0);
        const bob = Math.abs(Math.sin(time * 2)) * 0.2;
        entity.mesh.position.y += bob; // Lumbering walk
        
        const r = data.size / 30;
        for(let i=0; i<pPositions.length; i+=3) {
            const bx = entity.basePositions[i];
            const bz = entity.basePositions[i+2];
            if (Math.sqrt(bx*bx + bz*bz) > 0.6 * r) { // Orbiting rocks
                const cos = Math.cos(time);
                const sin = Math.sin(time);
                pPositions[i] = bx * cos - bz * sin;
                pPositions[i+2] = bx * sin + bz * cos;
            }
        }
        entity.mesh.geometry.attributes['position'].needsUpdate = true;
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

      // Make aura expand dynamically
      if (data.type === 'aura') {
        entity.mesh.rotation.z += 0.1;
      }
    }
  }

  private createEntityMesh(data: PhysicsEntity): ParticleEntity {
    const geo = new THREE.BufferGeometry();
    const count = data.type === 'boss' || data.type === 'turret' || data.type === 'enemy_phoenix' ? 4000 : (data.type.startsWith('projectile') ? 100 : (data.type === 'aura' ? 500 : (['coin', 'gem', 'heart', 'xp_orb'].includes(data.type) ? 200 : 800)));
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    // Color based on type
    let color = new THREE.Color(0xffffff);
    if (data.type === 'bat') color.setHex(0xef4444);
    else if (data.type === 'slime') color.setHex(0x22c55e); // Green Slime
    else if (data.type === 'golem') color.setHex(0x7f1d1d); // Dark Red Golem
    else if (data.type === 'boss') color.setHex(0xf97316); // Orange fiery Boss
    else if (data.type === 'projectile_player') color.setHex(0xfbbf24);
    else if (data.type === 'projectile_enemy') color.setHex(0xfbbf24);
    else if (data.type === 'aura') color.setHex(0x06b6d4);
    else if (data.type === 'coin') color.setHex(0xfacc15); // Yellow
    else if (data.type === 'gem') color.setHex(0xc084fc); // Purple
    else if (data.type === 'heart') color.setHex(0xec4899); // Pinkish red
    else if (data.type === 'xp_orb') color.setHex(0x38bdf8); // Glowing Cyan/Light Blue
    else if (data.type === 'fire') color.setHex(0xff5500); // Orange/Red
    else if (data.type === 'egg') color.setHex(0xffaa00); // Golden Egg
    else if (data.type === 'turret') color.setHex(0xffffff); // Use original bird colors

    // If ability was cast by the Top AI, override its visual color to Red to match the AI Phoenix
    if (data.ownerId === 'ai1' && (data.type.startsWith('projectile') || data.type === 'aura' || data.type === 'fire' || data.type === 'egg')) {
        color.setHex(0xff3333);
    } else if (data.ownerId === 'player' && this.gameState.currentGameMode() === 'ai_vs_ai' && (data.type.startsWith('projectile') || data.type === 'aura' || data.type === 'fire' || data.type === 'egg')) {
        color.setHex(0xd946ef); // Fuchsia for Bottom AI in AI vs AI
    }

    const r = data.size / 30; // Scale factor

    for (let i=0; i<count; i++) {
      const idx = i*3;
      let x = 0, y = 0, z = 0;

      if (data.type === 'slime') {
          // Complex Slime: 30% Dense Core, 70% Translucent Membrane
          const isCore = i < count * 0.3;
          const rad = isCore ? Math.cbrt(Math.random()) * r * 0.4 : Math.cbrt(Math.random()) * r;
          const u = Math.random() * Math.PI * 2;
          const v = Math.acos(Math.random()); // Hemisphere
          
          x = rad * Math.sin(v) * Math.cos(u);
          z = rad * Math.sin(v) * Math.sin(u);
          y = (rad * Math.cos(v) - r * 0.5) * (isCore ? 0.9 : 1.1); // Slightly taller membrane
          
          // Color gradient: Core is toxic yellow/white, membrane is dark green
          if (isCore) {
              const mix = Math.random();
              col[idx] = 0.8 + mix * 0.2; col[idx+1] = 1.0; col[idx+2] = 0.2 + mix * 0.5; // Toxic Yellow-Green
          } else {
              col[idx] = 0.1; col[idx+1] = 0.6 + Math.random() * 0.4; col[idx+2] = 0.2; // Neon Green
          }
      }
      else if (data.type === 'bat') {
          // Complex Bat: Body (20%), Left Wing (40%), Right Wing (40%)
          const p = Math.random();
          if (p < 0.2) {
              // Body
              x = (Math.random() - 0.5) * 0.6 * r;
              y = (Math.random() - 0.5) * 0.8 * r;
              z = (Math.random() - 0.5) * 0.6 * r;
              // Red glowing eyes
              if (y > 0.2 * r && Math.abs(x) > 0.1 * r && z > 0.2 * r) {
                  col[idx] = 1.0; col[idx+1] = 0.0; col[idx+2] = 0.0;
              } else {
                  col[idx] = 0.2 + Math.random()*0.2; col[idx+1] = 0.0; col[idx+2] = 0.0; // Dark crimson body
              }
          } else {
              // Wings
              const isLeft = p < 0.6;
              const span = Math.random() * r * 2.5; // Wing span
              const depth = (Math.random() - 0.5) * 0.3 * r;
              const swoop = Math.sin((span / (r*2.5)) * Math.PI) * 0.5 * r; // Wing curve
              
              x = isLeft ? -span : span;
              y = swoop + (Math.random() - 0.5) * 0.2 * r;
              z = depth - (span * 0.2); // Wings angle slightly back
              
              const edge = span / (r*2.5);
              col[idx] = 0.5 - edge * 0.3; col[idx+1] = 0.0; col[idx+2] = 0.1 + edge * 0.2; // Purple-ish edges
          }
      }
      else if (data.type === 'golem') {
          // Complex Golem: Core (20%), Floating jagged rocks (80%)
          const p = Math.random();
          if (p < 0.2) {
              // Magma Core
              const rad = Math.cbrt(Math.random()) * r * 0.6;
              const u = Math.random() * Math.PI * 2;
              const v = Math.acos(2 * Math.random() - 1);
              x = rad * Math.sin(v) * Math.cos(u);
              y = rad * Math.sin(v) * Math.sin(u);
              z = rad * Math.cos(v);
              col[idx] = 1.0; col[idx+1] = 0.2 + Math.random()*0.4; col[idx+2] = 0.0; // Hot Orange/Red
          } else {
              // Rocks
              const rockCenter = {
                  x: (Math.random() - 0.5) * r * 2.5,
                  y: (Math.random() - 0.5) * r * 3,
                  z: (Math.random() - 0.5) * r * 2.5
              };
              // Distribute particles around rock center
              x = rockCenter.x + (Math.random() - 0.5) * 0.5 * r;
              y = rockCenter.y + (Math.random() - 0.5) * 0.5 * r;
              z = rockCenter.z + (Math.random() - 0.5) * 0.5 * r;
              
              const gray = 0.1 + Math.random() * 0.15;
              col[idx] = gray; col[idx+1] = gray * 0.8; col[idx+2] = gray * 0.8; // Dark rocky color
          }
      }
      else if (data.type === 'boss') {
          // Demonic Fiery Skull
          const p = Math.random();
          if (p < 0.6) {
              // Skull Dome (Upper half sphere)
              const u = Math.random() * Math.PI * 2;
              const v = Math.acos(Math.random()); // Top half
              const rad = r * 1.5 + (Math.random() - 0.5) * 0.3 * r;
              x = rad * Math.sin(v) * Math.cos(u);
              z = rad * Math.sin(v) * Math.sin(u);
              y = rad * Math.cos(v) + r * 0.5; // Shift up
              
              // Eye Sockets (hollow them out)
              if (y > r * 0.8 && y < r * 1.5 && z > r * 0.5 && Math.abs(Math.abs(x) - r * 0.6) < r * 0.4) {
                  // Push particles into the eye socket to make it hollow and glowing
                  z -= r * 0.8;
                  col[idx] = 1.0; col[idx+1] = 1.0; col[idx+2] = 1.0; // White hot eyes
              } else {
                  const heat = 1.0 - (y / (r * 2));
                  col[idx] = 1.0; col[idx+1] = heat * 0.5; col[idx+2] = 0.0; // Orange to Red gradient
              }
          } else if (p < 0.85) {
              // Jaw (Lower half, detached slightly)
              x = (Math.random() - 0.5) * r * 2.2;
              y = -r * 0.5 + (Math.random() - 0.5) * 0.4 * r;
              z = (Math.random() - 0.5) * r * 1.8 + (Math.abs(x) * 0.5); // Curved jaw
              col[idx] = 0.8; col[idx+1] = 0.2; col[idx+2] = 0.0; // Darker red jaw
          } else {
              // Floating horns/crown
              const isLeft = Math.random() > 0.5;
              const t = Math.random();
              const spread = t * r * 1.5;
              x = isLeft ? -(r + spread) : (r + spread);
              y = r * 1.5 + t * r * 2 + (Math.random() - 0.5) * 0.3 * r;
              z = -t * r + (Math.random() - 0.5) * 0.3 * r; // Horns curve back
              col[idx] = 1.0; col[idx+1] = 0.6 - t * 0.6; col[idx+2] = 0.0; // Orange to Red horns
          }
      }
      else if (data.type === 'heart') {
          // Math curve for a heart
          const t = Math.random() * Math.PI * 2;
          const rad = Math.random() * r * 0.05; 
          x = 16 * Math.pow(Math.sin(t), 3) * rad;
          y = (13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t)) * rad;
          z = (Math.random() - 0.5) * r * 0.2;
      }
      else if (data.type === 'gem' || data.type === 'xp_orb') {
          // Diamond shape (Octahedron)
          x = (Math.random() - 0.5) * r;
          y = (Math.random() - 0.5) * r * 2;
          z = (Math.random() - 0.5) * r;
          const sum = Math.abs(x/r) + Math.abs(y/(r*2)) + Math.abs(z/r);
          if (sum > 0.5) {
             x /= (sum * 2); y /= (sum * 2); z /= (sum * 2);
          }
      }
      else if (data.type === 'coin') {
          // Torus / Ring
          const angle = Math.random() * Math.PI * 2;
          const rad = r * 0.8 + (Math.random() - 0.5) * r * 0.2;
          x = Math.cos(angle) * rad;
          y = Math.sin(angle) * rad;
          z = (Math.random() - 0.5) * r * 0.1;
      }
      else if (data.type === 'aura') {
         // Ring of particles
         const angle = Math.random() * Math.PI * 2;
         x = Math.cos(angle) * r;
         y = Math.sin(angle) * r;
         z = (Math.random() - 0.5) * 0.5;
      } 
      else if (data.type === 'fire') {
         // Chaotic cloud
         x = (Math.random() - 0.5) * r * 2.5;
         y = (Math.random() - 0.5) * r * 2.5;
         z = (Math.random() - 0.5) * r * 2.5;
      }
      else if (data.type === 'egg') {
         // Golden Torus Knot Core + Swirling Vortex Shell
         const t = Math.random() * Math.PI * 2;
         const p = 3; const q = 4;
         const rad_knot = Math.cos(q * t) + 2;
         const knotX = rad_knot * Math.cos(p * t) * r * 0.3;
         const knotY = rad_knot * Math.sin(p * t) * r * 0.3;
         const knotZ = -Math.sin(q * t) * r * 0.3;
         
         const u = Math.random() * Math.PI * 2;
         const v = Math.random() * Math.PI;
         const vortexR = r * 1.5 * (1 - Math.pow(Math.random(), 3)); 
         
         if (Math.random() > 0.3) {
             x = knotX + (Math.random() - 0.5) * r * 0.1;
             y = knotY + (Math.random() - 0.5) * r * 0.1;
             z = knotZ + (Math.random() - 0.5) * r * 0.1;
         } else {
             x = vortexR * Math.sin(v) * Math.cos(u);
             y = vortexR * Math.sin(v) * Math.sin(u);
             z = vortexR * Math.cos(v);
         }
      }
      else if (data.type === 'turret') {
         // Copy baby bird from main bird base positions (scaled down and animated)
         if (this.bird && this.bird.basePositions && this.bird.basePositions.length > idx + 2) {
             const baseX = this.bird.basePositions[idx];
             const baseY = this.bird.basePositions[idx+1];
             const baseZ = this.bird.basePositions[idx+2];
             
             const flapAmount = Math.abs(baseX) * 0.5;
             const flapPhase = (Date.now() * 0.01) - baseZ * 2.0;
             const flapOffset = Math.sin(flapPhase) * flapAmount;
             
             x = baseX * 0.4 * r;
             y = (baseY + flapOffset) * 0.4 * r;
             z = baseZ * 0.4 * r;
         }
      }
      else {
         // Default Sphere
         const u = Math.random() * Math.PI * 2;
         const v = Math.acos(2 * Math.random() - 1);
         const rad = Math.cbrt(Math.random()) * r;
         x = rad * Math.sin(v) * Math.cos(u);
         y = rad * Math.sin(v) * Math.sin(u);
         z = rad * Math.cos(v);
      }

      pos[idx] = x;
      pos[idx+1] = y;
      pos[idx+2] = z;

      // Add a bit of jitter to colors
      if (data.type === 'fire') {
          const rand = Math.random();
          if (rand > 0.6) { col[idx] = 1.0; col[idx+1] = 0.8; col[idx+2] = 0.0; } // Yellow
          else if (rand > 0.3) { col[idx] = 1.0; col[idx+1] = 0.3; col[idx+2] = 0.0; } // Orange
          else { col[idx] = 0.8; col[idx+1] = 0.0; col[idx+2] = 0.0; } // Red
      } else if (data.type === 'turret' && this.bird) {
          // The turret (baby phoenix) reuses the player bird's
          // construction and colors, across both particle buffers.
          const c = this.birdColorAt(this.bird, i);
          col[idx] = c[0];
          col[idx+1] = c[1];
          col[idx+2] = c[2];
      } else if (data.type === 'enemy_phoenix' && this.bird) {
          const c = this.birdColorAt(this.bird, i);
          col[idx] = 1.0 - c[0];
          col[idx+1] = 1.0 - c[1];
          col[idx+2] = 1.0 - c[2];
      } else if (data.type === 'egg') {
          const rand = Math.random();
          if (rand > 0.8) { col[idx] = 1.0; col[idx+1] = 1.0; col[idx+2] = 0.8; } // White/Gold
          else if (rand > 0.4) { col[idx] = 1.0; col[idx+1] = 0.8; col[idx+2] = 0.0; } // Bright Gold
          else { col[idx] = 1.0; col[idx+1] = 0.3; col[idx+2] = 0.0; } // Fiery Orange
      } else {
          col[idx] = color.r * (0.8 + Math.random()*0.4);
          col[idx+1] = color.g * (0.8 + Math.random()*0.4);
          col[idx+2] = color.b * (0.8 + Math.random()*0.4);
      }
    }
    
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    
    const material = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Points(geo, material);
    mesh.frustumCulled = false;
    
    // Store base positions for complex entities to allow vertex animation
    const basePositions = ['slime', 'bat', 'golem', 'boss', 'egg', 'turret', 'enemy_phoenix'].includes(data.type) ? new Float32Array(pos) : undefined;

    return { mesh, type: data.type, basePositions, timeOffset: Math.random() * 1000 };
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateBounds();
  }
}
