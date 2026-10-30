import { Component, ElementRef, OnInit, OnDestroy, ViewChild, NgZone, effect, inject } from '@angular/core';
import { GameStateService, STAMINA } from '../../services/game-state.service';
import { AudioService } from '../../services/audio.service';
import { WORLDS, HOSTILE_RGB } from '../../constants/game.constants';
import { PhysicsEntity, WorldTheme } from '../../models/game.models';
import { buildEntityGeometry } from './entity-builder';
import { PhoenixState, ParticleEntity, DyingBurst } from './phoenix-state';
import { Rgb3, PhoenixSkin, PHOENIX_SKINS, HOSTILE_SKIN, phoenixSkinById, phoenixSkinForWorld } from './phoenix-skins';
import { pointInGlyph } from './phoenix-glyph';
import { makeBackdropTexture, makeScrollBackdropTexture, silColor, themePainters, wallPainters } from './theme-painters';
import { EntitySync } from './entity-sync';
import { BirdPhysics, BASE_SPEED_STAT } from './bird-physics';
import { getPhoenixFrames, ensureAshFrames } from './phoenix-sprite';
import { bossDefFor } from '../../data/boss-rig';
export { phoenixSkinForWorld } from './phoenix-skins';
import * as THREE from 'three';


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
  readonly entitySync = new EntitySync(this);
  readonly birdPhysics = new BirdPhysics(this);
  @ViewChild('bgCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  public gameState = inject(GameStateService);
  private audioService = inject(AudioService);
  private renderer!: THREE.WebGLRenderer;
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
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
  // World scroll (World 1 Finish): when the selected world's
  // scroll record is enabled, the composited backdrop scrolls
  // downward during a run and themed side walls scroll with it,
  // so the phoenix reads as flying up through the world forever.
  // One accumulated distance drives both textures (scrollScreens,
  // in screen heights), which makes wall and background sync
  // exact by construction. The rate derives from the cruise law:
  // cruise speed over the visible height at the flight plane,
  // scaled by the same speed multiplier the bird flies with and
  // by the world's data speedFactor. Walls: two narrow strips at
  // z = -20 between the backdrop and the flight plane; their
  // inner face sits at WALL_FACE_NDC of the half-width, and
  // wallInsetX (the BirdPhysicsHost clamp) keeps the bird's
  // flight out of the wall zone. boundX itself never changes.
  private static readonly WALL_Z = -20;
  private static readonly WALL_FACE_FRACTION = 0.09; // of the screen width, per side
  private static readonly WALL_CANVAS_W = 256;
  private static readonly WALL_CANVAS_H = 1024;
  // The wall canvas spans this many screen widths from the face
  // line outward (the rock profile lives at about 30 percent of
  // it; the rest is rock mass running past the screen edge).
  private static readonly WALL_SPAN_FRACTION = 0.12;
  private scrollEnabled = false;
  private scrollFrozen = false; // harness-only, via the debug hook (frame-diff censuses need a still backdrop)
  private scrollScreens = 0;
  private scrollRateNow = 0; // screen heights per second, last computed
  public wallInsetX = 0;
  private wallGroup: THREE.Group | null = null;
  private wallTexLeft: THREE.CanvasTexture | null = null;
  private wallTexRight: THREE.CanvasTexture | null = null;
  private wallMeshLeft: THREE.Mesh | null = null;
  private wallMeshRight: THREE.Mesh | null = null;
  private wallCanvas: HTMLCanvasElement | null = null;
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
  public goldenAuraMesh!: THREE.Points;
  public celestialShieldMesh!: THREE.Points;
  private drillAuraMesh!: THREE.Points;
  public cosmicTrailMesh!: THREE.Points;
  private animationId!: number;
  
  public bird!: PhoenixState;
  private aiBird!: PhoenixState;
  public readonly MAX_HISTORY = 600;
  
  public boundX = 15;
  public boundY = 10;
  public birdScale = 0.5; // Scaled down
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
  public trailAccumulator = 0;
  private glowTexture: THREE.Texture | null = null;

  private mouseTarget = new THREE.Vector3(0, -10, -15);
  public entityPool = new Map<string, ParticleEntity>();
  public dyingBursts: DyingBurst[] = [];
  public lastSyncMs = 0;
  public fullAnimIds = new Set<string>();
  private ringGlowTexture: THREE.Texture | null = null;
  private haloGlowTexture: THREE.Texture | null = null;

  // Player-bird visual state machine for the Section 2.2 death and
  // rebirth sequences. Gameplay death and revive live in the game
  // component; this only animates what the signals already announce
  // (isDeadMenuOpen, isRebirthing, immortalUntil).
  public visState: 'alive' | 'dying' | 'dead' | 'rebirth' = 'alive';
  private visT0 = 0;
  private prevDeadMenu = false;
  private prevRebirthing = false;
  private lastImmortalSeen = 0;
  // Bird Rebuild: scale multiplier the rebirth reform ramp drives
  // through the BirdPhysicsHost interface (1 outside the ramp).
  public visScaleMul = 1;
  private rebirthFromDeath = false;


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
    this.createBirdRig(this.bird, phoenixSkinForWorld(this.gameState.selectedWorldIndex()));

    this.aiBird = this.createBirdState('crimson'); // Different theme for AI
    this.initHistory(this.aiBird);
    this.createBirdRig(this.aiBird, HOSTILE_SKIN);
    
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
          scrollState: () => this.scrollState(),
          setScrollScreens: (v: number) => { this.scrollScreens = v; },
          setScrollFrozen: (v: boolean) => { this.scrollFrozen = !!v; },
          backdropImage: () => (this.backdropTex?.image as HTMLCanvasElement | undefined)?.toDataURL() ?? null,
          wallImage: () => this.wallCanvas?.toDataURL() ?? null,
          // Flight lore proofs (Oct 28, 2026): the player bird's
          // live orientation and flight state, read from the bird
          // record itself. headingDeg is the sprite heading in
          // screen terms (90 = straight up-screen).
          // The player bird's live screen position (the same
          // signal bird-physics maintains), for harness framing
          // and UI-tap checks on screens where the game component
          // (and its __phoenixS1 hook) is not mounted.
          screenPos: () => ({ ...this.gameState.phoenixScreenPos() }),
          birdState: () => {
            const b = this.bird;
            let deg = (b.headingAngle * 180 / Math.PI) % 360;
            if (deg < 0) deg += 360;
            // Fix Round 4: headingDeg is the HEAD angle; bodyDeg
            // is the lagging body angle and bendDeg their signed
            // shortest-arc difference, for the turning proofs.
            let bodyDeg = (b.bodyAngle * 180 / Math.PI) % 360;
            if (bodyDeg < 0) bodyDeg += 360;
            let bendDeg = (b.bodyAngle - b.headingAngle) * 180 / Math.PI;
            while (bendDeg > 180) bendDeg -= 360;
            while (bendDeg < -180) bendDeg += 360;
            return {
              headingDeg: Math.round(deg * 10) / 10,
              bodyDeg: Math.round(bodyDeg * 10) / 10,
              bendDeg: Math.round(bendDeg * 10) / 10,
              flapTime: Math.round(b.flapTime * 1000) / 1000,
              hovering: b.hovering,
              bankDeg: Math.round(b.currentBank * 180 / Math.PI * 10) / 10,
              speedWorld: Math.round(b.velocity.length() * 100) / 100,
              ashMix: Math.round(b.renderAshMix * 100) / 100,
              downPhase: this.gameState.playerDownPhase(),
            };
          },
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
    if (!this.particles || !this.bird) return;

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

    // Player and AI birds: colored by their skins, not the world
    // (spec 2.4). Since the Bird Rebuild the skin colors are baked
    // into the sprite textures per skin, so there is nothing to
    // recolor here; the ambient hue-collision shift above is the
    // part of this pass the birds still rely on.


    if (this.bgGlow) {
        const mat = this.bgGlow.material as THREE.MeshBasicMaterial;
        mat.color.setRGB(p2[0], p2[1], p2[2]);
    }
  }

  // ------------------------------------------------------------------
  // Stage 6 theme scenes: sky, parallax, ground band, atmosphere.
  // Everything is driven by the world's Stage 0 themeData record;
  // the canvas painters live in theme-painters.ts (moved there in
  // the code organization pass, Oct 27, 2026). Brightness discipline from
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
    const painters = themed && td ? themePainters(worldIndex) : null;
    if (painters && td) {
      if (!this.backdropMesh) {
        this.backdropMesh = new THREE.Mesh(new THREE.PlaneGeometry(460, 130), new THREE.MeshBasicMaterial({}));
        this.backdropMesh.position.set(0, -16, -44);
        this.scene.add(this.backdropMesh);
      }
      this.backdropTex?.dispose();
      // A scroll-enabled world gets the vertically tileable
      // crossfade texture on the same composited plane; every
      // other world keeps the static texture exactly as before.
      this.scrollEnabled = !!td.scroll?.enabled;
      this.backdropTex = this.scrollEnabled
        ? makeScrollBackdropTexture(painters, td)
        : makeBackdropTexture(painters, td);
      this.backdropTex.repeat.x = 2;
      const mat = this.backdropMesh.material as THREE.MeshBasicMaterial;
      mat.map = this.backdropTex; mat.needsUpdate = true;
      this.backdropMesh.visible = true;
      this.bgGlow.visible = false;
    } else {
      if (this.backdropMesh) this.backdropMesh.visible = false;
      this.bgGlow.visible = true;
      this.scrollEnabled = false;
    }

    // Side walls (World 1 Finish): built from the world's wall
    // theme key when its scroll record is enabled and a painter
    // exists for the key. One canvas, two textures (the left
    // strip mirrors the canvas so its face edge lands on the
    // channel side), two narrow planes at WALL_Z. The material
    // uses an alphaTest cutout instead of blending: the strip's
    // channel side of the rock profile is genuinely empty, the
    // cutout keeps the walls in the opaque pass (no blend cost;
    // a blended transparent strip measured a real frame-time
    // cost under the software renderer), and every gameplay
    // entity sits closer to the camera, so entities, the boss,
    // projectiles, pickups, and both birds always render above
    // the walls.
    const wallPainter = painters && td && this.scrollEnabled && td.scroll?.wall
      ? wallPainters(worldIndex) : null;
    if (wallPainter && td) {
      const canvas = document.createElement('canvas');
      canvas.width = ParticleBgComponent.WALL_CANVAS_W;
      canvas.height = ParticleBgComponent.WALL_CANVAS_H;
      const wctx = canvas.getContext('2d')!;
      wallPainter(wctx, canvas.width, canvas.height, td);
      this.wallCanvas = canvas;
      if (!this.wallGroup) {
        this.wallGroup = new THREE.Group();
        const mkMat = () => new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
        this.wallMeshLeft = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mkMat());
        this.wallMeshRight = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mkMat());
        this.wallGroup.add(this.wallMeshLeft, this.wallMeshRight);
        this.scene.add(this.wallGroup);
      }
      this.wallTexLeft?.dispose();
      this.wallTexRight?.dispose();
      // No mipmaps on the wall strips: they render at one fixed
      // scale per viewport, and the trilinear fetch was a
      // measurable slice of their software-renderer cost.
      this.wallTexLeft = new THREE.CanvasTexture(canvas);
      this.wallTexLeft.wrapS = THREE.RepeatWrapping;
      this.wallTexLeft.wrapT = THREE.RepeatWrapping;
      this.wallTexLeft.generateMipmaps = false;
      this.wallTexLeft.minFilter = THREE.LinearFilter;
      this.wallTexLeft.repeat.x = -1; // face edge on the channel side
      this.wallTexLeft.repeat.y = 2; // one tile per visible height (layoutWalls)
      this.wallTexRight = new THREE.CanvasTexture(canvas);
      this.wallTexRight.wrapS = THREE.RepeatWrapping;
      this.wallTexRight.wrapT = THREE.RepeatWrapping;
      this.wallTexRight.generateMipmaps = false;
      this.wallTexRight.minFilter = THREE.LinearFilter;
      this.wallTexRight.repeat.y = 2;
      (this.wallMeshLeft!.material as THREE.MeshBasicMaterial).map = this.wallTexLeft;
      (this.wallMeshLeft!.material as THREE.MeshBasicMaterial).needsUpdate = true;
      (this.wallMeshRight!.material as THREE.MeshBasicMaterial).map = this.wallTexRight;
      (this.wallMeshRight!.material as THREE.MeshBasicMaterial).needsUpdate = true;
      this.wallGroup.visible = true;
    } else if (this.wallGroup) {
      this.wallGroup.visible = false;
    }
    this.layoutWalls();

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
    ctx.fillStyle = silColor([0.30, 0.05, 0.05], 1.0, 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // The lit side, waxing from the right: the right limb arc,
    // closed by the terminator half-ellipse whose bulge flips
    // at half phase.
    ctx.fillStyle = silColor([0.62, 0.13, 0.10], 1.0, 1.0);
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
  public heartBeatScale(timeOffset: number): number {
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


  // Fix Round 2 (A11, Carter's rule): input that lands on a UI
  // control is consumed by the UI and never becomes a flight
  // target, on every screen. This handler is the bird's steering
  // source and is bound to window touchstart, so a tap on the
  // pause button used to park the phoenix on the button.
  private isUiTarget(event: Event): boolean {
    const t = event.target as HTMLElement | null;
    return !!t && typeof t.closest === 'function'
      && !!t.closest('button, a, input, select, textarea, [data-ui]');
  }

  private onMouseMove(event: MouseEvent) {
    if (this.isUiTarget(event)) return;
    if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen()) return;
    this.updateMouseTarget(event.clientX, event.clientY, false);
  }

  private onTouchMove(event: TouchEvent) {
    if (this.isUiTarget(event)) return;
    if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen()) return;
    if (event.touches.length > 0) {
      // Prevent the WebView from scrolling / rubber-banding while the finger drives the Phoenix,
      // but only during gameplay so menu UI (buttons, scroll) still works.
      // Fix Round 1, Part 4: this handler is also bound to
      // touchstart, and preventDefault on a touchstart suppresses
      // the browser's synthesized click, which made every DOM
      // button on the game screen untappable by touch (the pause
      // button on Carter's phone). Only touches that land on the
      // WebGL canvas itself (steering touches) are prevented;
      // touches on DOM UI keep their default behavior so their
      // click events fire. Steering drags stay scroll-safe via the
      // game component's own touchmove prevention.
      const onCanvas = event.target === this.canvasRef?.nativeElement;
      if (this.gameState.activeScreen() === 'game' && event.cancelable && onCanvas) event.preventDefault();
      // Relative drag steering (Carter, Oct 29, 2026): on the game
      // screen a touch never sets an absolute target. The game
      // component turns finger deltas into gameState.steerScreenTarget,
      // which the render loop consumes below. Menus keep follow-finger.
      if (this.gameState.activeScreen() === 'game') return;
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
      theme, group: new THREE.Group(), sprite: null, ashSprite: null, ghostSprites: [], glow: null, basePositions: new Float32Array(0),
      inFill: new Uint8Array(0), bufferIndex: new Uint16Array(0), pointRegion: new Uint8Array(0), sparkle: new Uint8Array(0),
      skinId: 'ember', flapRate: 1, climbTime: 0, spoolT: -1, wasDashing: false, wasDrilling: false, wasRushing: false, flashUntil: 0, reformUntil: 0, glowSpanFactor: 1.35,
      phoenixCount: 4000, currentBank: 0, flapTime: 0, position: new THREE.Vector3(0, -5, -15),
      velocity: new THREE.Vector3(0, 1, 0), previousVelocity: new THREE.Vector3(0, 1, 0),
      targetWaypoint: new THREE.Vector3(), historyPos: [], historyQuat: [],
      headingAngle: Math.PI / 2, bodyAngle: Math.PI / 2, cruiseSpeedNow: 0, bendGeo: null, bendBase: null, drillSpin: 0, trailFade: 1, renderOpacity: 1, renderTint: new THREE.Color(1, 1, 1), renderAshMix: 0, hovering: false
    };
  }

  // Bird cruise speed in world units per second at speed multiplier 1:
  // the visible width at the flight plane divided by the canonical
  // crossing time.
  private nominalBirdSpeed(): number {
    return (this.boundX * 2) / ParticleBgComponent.BIRD_CROSSING_SECONDS;
  }

  // World scroll rate in screen heights per second: the bird's
  // cruise speed (the same crossing law nominalBirdSpeed encodes,
  // times the same speed multiplier the player bird flies with,
  // mirrored from bird-physics) expressed against the visible
  // height at the flight plane, times the world's data factor.
  private scrollScreenRate(): number {
    if (!this.scrollEnabled) return 0;
    const gs = this.gameState;
    let mult: number;
    if (gs.currentGameMode() === 'ai_vs_ai') {
      mult = gs.ai2PhoenixSpeed() / BASE_SPEED_STAT;
    } else {
      mult = gs.currentStats().speed / BASE_SPEED_STAT;
      if (Date.now() < gs.speedBoostUntil) mult *= 2.0;
      if (gs.isDrilling()) {
        const modifiers = gs.currentStats().unlockedAbilities['drill_attack']?.modifiers;
        if (modifiers && modifiers['speed']) mult *= modifiers['speed'];
      }
    }
    const factor = WORLDS[this.themedWorldIndex]?.themeData?.scroll?.speedFactor ?? 1;
    return (this.nominalBirdSpeed() * mult / (2 * this.boundY)) * factor;
  }

  // Positions the wall strips for the current bounds and sets the
  // bird's wall clamp (wallInsetX). Called on world change and on
  // resize. The strip plane is two visible heights tall at WALL_Z
  // with texture repeat.y = 2, so one texture tile spans exactly
  // one visible height and the strip's offset advances in the
  // same accumulated screen heights as the backdrop's.
  private layoutWalls() {
    const active = !!this.wallGroup && this.wallGroup.visible;
    this.wallInsetX = active
      ? 2 * ParticleBgComponent.WALL_FACE_FRACTION * this.boundX : 0;
    if (!this.wallGroup || !this.wallMeshLeft || !this.wallMeshRight || !this.camera) return;
    const distRatio = (this.camera.position.z - ParticleBgComponent.WALL_Z) / 20;
    const visH = 2 * this.boundY * distRatio;
    const visW = 2 * this.boundX * distRatio;
    const faceX = (1 - 2 * ParticleBgComponent.WALL_FACE_FRACTION) * (visW / 2);
    const stripW = ParticleBgComponent.WALL_SPAN_FRACTION * visW;
    const stripH = visH * 2;
    this.wallMeshLeft.scale.set(stripW, stripH, 1);
    this.wallMeshLeft.position.set(-(faceX + stripW / 2), 0, ParticleBgComponent.WALL_Z);
    this.wallMeshRight.scale.set(stripW, stripH, 1);
    this.wallMeshRight.position.set(faceX + stripW / 2, 0, ParticleBgComponent.WALL_Z);
  }

  // Harness-facing scroll state (debug gate only, like sceneStats).
  private scrollState() {
    const visHb = 2 * this.boundY * (49 / 20); // visible height at the backdrop plane
    return {
      enabled: this.scrollEnabled,
      worldIndex: this.themedWorldIndex,
      screens: Math.round(this.scrollScreens * 1000) / 1000,
      rateScreensPerSec: Math.round(this.scrollRateNow * 1000) / 1000,
      backdropOffsetY: this.backdropTex ? Math.round(this.backdropTex.offset.y * 10000) / 10000 : -1,
      backdropVisibleFraction: Math.round((visHb / 130) * 10000) / 10000,
      wallEnabled: !!this.wallGroup && this.wallGroup.visible,
      wallOffsetY: this.wallTexRight ? Math.round(this.wallTexRight.offset.y * 10000) / 10000 : -1,
      wallInsetX: Math.round(this.wallInsetX * 100) / 100,
      boundX: Math.round(this.boundX * 100) / 100,
      faceScreenFraction: ParticleBgComponent.WALL_FACE_FRACTION,
    };
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

  // One silhouette point's display color under the bird's current
  // skin, computed from the sampling data (base positions and region
  // routing) rather than a live buffer. Used by the turret
  // construction, which copies the player bird's colors; since the
  // Bird Rebuild the bird itself is a sprite, so the data path is
  // the only path.
  public birdColorAt(bird: PhoenixState, k: number): Rgb3 {
    return this.colorForPoint(bird, phoenixSkinById(bird.skinId), k);
  }

  private applySkin(skin: PhoenixSkin) {
    const bird = this.bird;
    if (!bird || !bird.sprite) return;
    bird.skinId = skin.id;
    bird.glowSpanFactor = skin.glowSpan;
    // The sprite's frame set follows bird.skinId in the physics
    // render write each substep, so only the glow (tint and ring
    // treatment) is swapped here.
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

  private initThree() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvasRef.nativeElement, alpha: true, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
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
    
    if (!this.glowTexture) this.glowTexture = this.createGlowTexture();
    const trailMat = new THREE.PointsMaterial({ size: 0.25, map: this.glowTexture, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
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

  private createBirdRig(bird: PhoenixState, skin: PhoenixSkin) {
    // Silhouette sampling (spec Section 2.1 distribution: about 45
    // percent inner body fill sampled from the glyph silhouette, 35
    // percent wings and tail ribbon, 20 percent outer fringe). Since
    // the Bird Rebuild this is DATA only: the turret companion and
    // the codex enemy_phoenix builders copy the bird's construction
    // from these arrays (entity-sync animates them per frame), and
    // colorForPoint colors them. The player and rival birds are
    // drawn sprites now (phoenix-sprite.ts), never these points.
    const FILL_COUNT = 1800;
    const count = bird.phoenixCount;
    bird.basePositions = new Float32Array(count * 3);
    bird.inFill = new Uint8Array(count);
    bird.bufferIndex = new Uint16Array(count);
    bird.pointRegion = new Uint8Array(count);
    bird.sparkle = new Uint8Array(count);
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
      if (region === 1) { bird.inFill[i] = 1; bird.bufferIndex[i] = fillNext++; }
      else { bird.inFill[i] = 0; bird.bufferIndex[i] = mainNext++; }
    }
    // The drawn bird rig: one shared plane geometry (1 by 1.25, the
    // bird's own aspect) for the main plane, the ash plane, and the
    // ghost ribbon, textured from the skin's pre-rendered flap
    // frames and oriented in screen space by the physics render
    // write. The group carries the planes so the battle visibility
    // toggle covers the whole rig at once.
    const frames = getPhoenixFrames(skin);
    const geo = new THREE.PlaneGeometry(1, 1.25);
    // Fix Round 4 bend geometry: the main and ash planes share a
    // segmented copy (12 height segments), whose vertices the
    // render write bends along the spine each frame so the body
    // visibly curves behind the head in a turn.
    const bendGeo = new THREE.PlaneGeometry(1, 1.25, 1, 12);
    bird.bendGeo = bendGeo;
    bird.bendBase = (bendGeo.attributes['position'].array as Float32Array).slice();
    const makePlane = (renderOrder: number, planeGeo: THREE.BufferGeometry = geo): THREE.Mesh => {
      const mat = new THREE.MeshBasicMaterial({
        map: frames.frames[0], transparent: true, opacity: 0.95,
        depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;
      mesh.position.copy(bird.position);
      return mesh;
    };
    bird.sprite = makePlane(3, bendGeo);
    bird.ashSprite = makePlane(3, bendGeo);
    bird.ashSprite.visible = false;
    bird.ghostSprites = [];
    for (let gi = 0; gi < 8; gi++) {
      // Worlds pass (Carter, Oct 29, 2026): the ghost ribbon planes
      // share the SAME bend geometry instance as the main and ash
      // planes, so every layer of the bird carries the identical
      // spine deformation the render write applies each frame.
      const g = makePlane(2, bendGeo);
      g.visible = false;
      bird.ghostSprites.push(g);
    }
    bird.group = new THREE.Group();
    bird.group.add(bird.ashSprite);
    for (const g of bird.ghostSprites) bird.group.add(g);
    bird.group.add(bird.sprite);
    this.scene.add(bird.group);
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

        // World scroll (World 1 Finish): during a run the backdrop
        // and the side walls stream downward together, so the
        // phoenix reads as flying up. One accumulated distance in
        // screen heights drives both texture offsets, converted
        // per texture: the backdrop's offset moves by the visible
        // fraction of its plane per screen height scrolled, the
        // wall strip's by exactly one tile per screen height (its
        // tile spans one visible height by construction). The
        // phase holds still on the menu and while paused.
        if (this.scrollEnabled && this.backdropTex) {
          // The down state freezes the world (flight lore death
          // flow): the scroll phase holds from the moment the bird
          // starts falling until the revive blast lands, not only
          // while the KO panel is open.
          const inRun = this.gameState.activeScreen() === 'game'
            && !this.gameState.isPaused() && !this.gameState.isDeadMenuOpen()
            && this.gameState.playerDownPhase() === 'none';
          this.scrollRateNow = this.scrollScreenRate();
          // A3: the Battle entrance holds the scroll at phase zero,
          // so Battle's first controllable frame is framed like the
          // other modes instead of landing mid-scroll.
          if (inRun && !this.scrollFrozen && !this.gameState.entranceScrollHold()) this.scrollScreens += this.scrollRateNow * dt;
          const visFrac = (2 * this.boundY * (49 / 20)) / 130;
          this.backdropTex.offset.y = (this.scrollScreens * visFrac) % 1;
          const wallOff = this.scrollScreens % 1;
          if (this.wallTexLeft) this.wallTexLeft.offset.y = wallOff;
          if (this.wallTexRight) this.wallTexRight.offset.y = wallOff;
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
        // down (3, 2.5, 2, 1.75, 1.5, 1.25) before any gameplay
        // visual is touched. Steps only ever go down within a
        // session. The ladder starts at the device ratio (capped at
        // 3, Fix Round 1 Part 1) so a DPR-3 phone renders natively
        // instead of upscaling a capped buffer.
        this.frameEmaMs = this.frameEmaMs * 0.96 + dt * 1000 * 0.04;
        if (nowMs - this.lastPrEvalMs > 2000) {
          this.lastPrEvalMs = nowMs;
          // The ladder only ever steps DOWN from the renderer's
          // starting ratio: on a client whose devicePixelRatio is
          // already at or below a rung, that rung is skipped (an
          // earlier draft stepped a DPR-1 client UP to 1.75 before
          // coming back down, making slow frames slower).
          const initialPr = Math.min(window.devicePixelRatio || 1, 3);
          const prSteps = [3, 2.5, 2, 1.75, 1.5, 1.25, 1].filter(s => s <= initialPr + 0.001);
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

        const steer = this.gameState.steerScreenTarget;
        if (steer) {
            this.gameState.steerScreenTarget = null;
            if (this.gameState.activeScreen() === 'game') this.updateMouseTarget(steer.x, steer.y, false);
        }
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
            this.birdPhysics.updateBirdPhysics(this.bird, targetForMainBird, baseSpeed, sdt, sFrameScale, false);
            if (isBattle && aiTarget3D) {
                this.birdPhysics.updateBirdPhysics(this.aiBird, aiTarget3D, baseSpeed, sdt, sFrameScale, true);
            }
        }

        this.updatePlayerVisualStates(dt, nowMs);

        this.entitySync.syncEntities();

        this.renderer.render(this.scene, this.camera);
        
        this.wasGameScreen = this.gameState.activeScreen() === 'game';
        this.animationId = requestAnimationFrame(render);
      };
      render();
    });
  }

  // Section 2.2 animation states that the per-frame bird physics
  // does not own: hit flash, the death sequence (cool to ash), and
  // the rebirth sequence (reform, flare). Driven entirely by signals
  // the game state already exposes; no gameplay timing changes.
  // Runs after the bird physics substeps, before the render.
  //
  // Bird Rebuild: the sequences crossfade the drawn sprite to its
  // ash copy instead of scattering point buffers. Timings are the
  // shipped ones: an 800 ms death cool, a 0.4 s reform ramp, a
  // flare window to 0.52 s, then the 450 ms reform flap burst.
  private updatePlayerVisualStates(dt: number, nowMs: number) {
    const bird = this.bird;
    if (!bird || !bird.sprite || !bird.ashSprite) return;
    const deadMenu = this.gameState.isDeadMenuOpen();
    const rebirthing = this.gameState.isRebirthing();
    const onGame = this.gameState.activeScreen() === 'game';

    // Death begins: the sequence owns the sprite from here.
    if (deadMenu && !this.prevDeadMenu && onGame && this.visState === 'alive') {
      this.visState = 'dying';
      this.visT0 = nowMs;
      ensureAshFrames(phoenixSkinById(bird.skinId));
    }
    // Revive (dead menu closes, run continues): rebirth sequence.
    if (!deadMenu && this.prevDeadMenu) {
      if (onGame && (this.visState === 'dying' || this.visState === 'dead')) {
        this.beginRebirth(bird, nowMs, true);
      } else {
        this.visState = 'alive';
      }
    }
    // The Rebirth ability's ash state ends: flare and reform.
    if (!rebirthing && this.prevRebirthing && onGame && this.visState === 'alive') {
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

    const mainMat = bird.sprite.material as THREE.MeshBasicMaterial;
    const ashMat = bird.ashSprite.material as THREE.MeshBasicMaterial;

    if (this.visState === 'dying' || this.visState === 'dead') {
      const p = Math.min(1, (nowMs - this.visT0) / 800);
      if (this.visState === 'dying' && p >= 1) this.visState = 'dead';
      // The living sprite fades as the ash copy takes over, sinking
      // and shrinking slightly; the glow shrinks to an ember (the
      // shipped death read). Physics is parked while the death menu
      // is open, so the ash pose composes from the frozen sprite.
      const sink = p * 1.3 * this.birdScale;
      const s = bird.sprite.scale.x * (1 - 0.18 * p);
      mainMat.opacity = 0.95 * (1 - p);
      bird.sprite.visible = p < 1;
      ashMat.opacity = 0.9 * p;
      bird.ashSprite.visible = p > 0;
      bird.ashSprite.position.copy(bird.sprite.position);
      bird.ashSprite.position.y -= sink;
      bird.ashSprite.rotation.copy(bird.sprite.rotation);
      bird.ashSprite.scale.set(s, s, s);
      for (const g of bird.ghostSprites) g.visible = false;
      if (bird.glow) {
        const span = 8 * this.birdScale * bird.glowSpanFactor * (1 - 0.75 * p);
        bird.glow.scale.set(span, span, 1);
        bird.glow.position.copy(bird.position);
        (bird.glow.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - p) + 0.08;
        bird.glow.visible = true;
      }
      return;
    }

    if (this.visState === 'rebirth') {
      const t = (nowMs - this.visT0) / 1000;
      if (t < 0.4) {
        // Reform: the sprite scales and fades back in; from death,
        // the ash copy dissolves over the same window.
        const e = 1 - Math.pow(1 - t / 0.4, 3);
        this.visScaleMul = 0.55 + 0.45 * e;
        mainMat.opacity = 0.95 * (0.25 + 0.75 * e);
        if (this.rebirthFromDeath) {
          ashMat.opacity = 0.9 * (1 - e);
          bird.ashSprite.visible = true;
          bird.ashSprite.position.copy(bird.sprite.position);
          bird.ashSprite.rotation.copy(bird.sprite.rotation);
          const s = bird.sprite.scale.x;
          bird.ashSprite.scale.set(s, s, s);
        }
        if (bird.glow) (bird.glow.material as THREE.SpriteMaterial).opacity = 0.5 * e;
      } else if (t < 0.52) {
        // Flare: one bright window, glow at 2 times wingspan.
        this.visScaleMul = 1;
        if (bird.glow) {
          const span = 8 * this.birdScale * 2.0;
          bird.glow.scale.set(span, span, 1);
          (bird.glow.material as THREE.SpriteMaterial).opacity = 0.85;
        }
        mainMat.opacity = 0.95;
        mainMat.color.setRGB(1.7, 1.7, 1.7);
        if (this.rebirthFromDeath) bird.ashSprite.visible = false;
      } else {
        this.visState = 'alive';
        this.visScaleMul = 1;
        this.rebirthFromDeath = false;
        bird.reformUntil = nowMs + 450; // reform with a flap burst
        mainMat.color.copy(bird.renderTint);
      }
      return;
    }

    // Hit flash overlay (80 ms): the sprite flashes white-hot; the
    // physics render write restores the base tint next substep, and
    // this pass restores it on frames physics does not run.
    if (nowMs < bird.flashUntil && this.visState === 'alive') {
      mainMat.color.setRGB(2.2, 2.2, 2.2);
    } else if (mainMat.color.r !== bird.renderTint.r || mainMat.color.g !== bird.renderTint.g || mainMat.color.b !== bird.renderTint.b) {
      mainMat.color.copy(bird.renderTint);
    }
  }

  private beginRebirth(bird: PhoenixState, nowMs: number, fromDeath: boolean) {
    this.visState = 'rebirth';
    this.visT0 = nowMs;
    this.rebirthFromDeath = fromDeath;
    this.visScaleMul = 0.55;
    ensureAshFrames(phoenixSkinById(bird.skinId));
    if (bird.sprite) bird.sprite.visible = true;
  }

  public wasGameScreen = false;


  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateBounds();
    this.layoutWalls();
  }
}
