import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService } from '../../services/game-state.service';
import { WORLDS } from '../../constants/game.constants';
import { TEMP_WORLDS, TEMP_MOVES_BY_TYPE, TempMoveType } from '../../data/temp-catalog';
import { buildEntityGeometry } from '../../components/particle-bg/entity-builder';
import * as THREE from 'three';

@Component({
  selector: 'app-codex',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './codex.component.html',
  styleUrls: ['./codex.component.css']
})
export class CodexComponent implements OnInit, OnDestroy {
  @ViewChild('previewCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  gameState = inject(GameStateService);
  
  // The real 10 realms. Display names are the canonical WORLDS names; the
  // Temp-phoenix realm names are retired as display names (visual spec
  // Section 1.5). The one-line descriptions are carried over from the
  // Temp-phoenix catalog, matched by boss identity so no content is lost.
  realms = WORLDS.map(w => ({
    id: w.id,
    name: w.name,
    bossName: w.bossName,
    bossTheme: w.bossTheme,
    description: TEMP_WORLDS.find(t => t.boss === w.bossName)?.description,
    status: 'available' as const
  }));

  isRealmUnlocked(id: number): boolean {
    return this.gameState.unlockedWorlds().includes(id);
  }

  // The classic 75-move archive (Temp-phoenix catalog, kept as collection
  // lore; this game's playable abilities live in the shop).
  moveArchive = TEMP_MOVES_BY_TYPE;
  moveTypes: Array<{ key: TempMoveType, label: string }> = [
    { key: 'hold', label: 'Hold (channeled)' },
    { key: 'double', label: 'Double-tap' },
    { key: 'triple', label: 'Triple-tap' }
  ];

  realmOneEnemies = [
    { id: 'slime', name: 'Ember Glob', desc: 'A bouncing mass of molten energy.', size: 20 },
    { id: 'bat', name: 'Gloomwing', desc: 'Fast, erratic flyer that haunts the crags.', size: 15 },
    { id: 'golem', name: 'Bastion Golem', desc: 'A slow lumbering tank of molten rock.', size: 60 },
    { id: 'imp', name: 'Cinder Imp', desc: 'A living spark. When it flares white, get off its line: it is about to charge straight through it.', size: 15 },
    { id: 'wisp', name: 'Aether Wisp', desc: 'A hollow ring that circles its prey, then darts through the ring it made. Do not stand at the center.', size: 15 },
    { id: 'pod', name: 'Brood Pod', desc: 'A drifting nest of cells. It bursts into Mites when killed, so finish it from as far away as you can.', size: 25 },
    { id: 'mite', name: 'Mite', desc: 'A tiny swarmer shaken loose from a Brood Pod. Trivial alone, a screen-filling storm in a pack.', size: 8 },
    { id: 'sentry_shard', name: 'Sentry Shard', desc: 'A floating crystal turret that anchors and fires on a steady beat. Its core eye glows before every shot, so keep moving between beats.', size: 30 },
    { id: 'seedmother', name: 'Seedmother', desc: 'A slow spore-bellied flyer that lays Rift Mines as it crosses the field. Kill the mother, or the field keeps growing.', size: 55 },
    { id: 'rift_mine', name: 'Rift Mine', desc: 'A spiked hazard with a blinking core. Shoot it from range to clear it safely; walk close and it bursts into a cross of fire.', size: 10 },
    { id: 'shieldback', name: 'Shieldback', desc: 'Its shield face always turns toward you and turns your fire aside: hits from the front land at quarter strength and spark off. Circle behind it, or pierce its flank, for full damage.', size: 50 },
    { id: 'pyre_moth', name: 'Pyre Moth', desc: 'A soft ball of flame with slow wings. When it starts flashing, back away: dead or alive, it bursts into a ring of fire.', size: 17 },
    { id: 'phantom', name: 'Shroud Phantom', desc: 'It fades out and slips away, then gathers again at your flank. Watch for the shimmer where it will return: nothing can hurt it while it is gone, and it cannot hurt you.', size: 30 },
    { id: 'wraith', name: 'Lance Wraith', desc: 'It keeps its distance and draws a thin red line on you. When the line burns bright the bolt is coming: break away from where you stood, or be somewhere else.', size: 35 },
    { id: 'chanter', name: 'War Chanter', desc: 'It never shoots. Every few seconds its ring pulses and every enemy it touches flies faster. Kill the singer first, or everything else gets worse.', size: 25 },
    { id: 'serpent', name: 'Loom Serpent', desc: 'A ribbon of segments that weaves after you. When it bunches up and its head flares, it is about to lunge straight through where you are: step aside, not back.', size: 25 },
    { id: 'darter', name: 'Storm Darter', desc: 'It lines up at the edge, wingtips sparking, then screams across your position spitting a three-shot fan at the midpoint. Keep moving across its line, never along it.', size: 22 },
    { id: 'boss', name: 'Demonic Skull', desc: 'The ruler of the Volcanic Crags. A terrifying fiery entity.', size: 100 }
  ];

  selectedEnemy = signal<any>(this.realmOneEnemies[0]);

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private currentMesh?: THREE.Points;
  private animationId!: number;

  ngOnInit() {
    this.initThree();
    this.renderEnemyPreview(this.selectedEnemy());
    this.animate();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animationId);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
  }

  selectEnemy(enemy: any) {
    this.selectedEnemy.set(enemy);
    this.renderEnemyPreview(enemy);
  }

  isUnlocked(id: string): boolean {
    return this.gameState.unlockedEnemies().includes(id);
  }

  close() {
    this.gameState.activeScreen.set('menu');
  }

  // --- THREE.JS PREVIEW LOGIC ---
  private initThree() {
    const canvas = this.canvasRef.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    // updateStyle false: the drawing buffer stays 400x400, but
    // Three must not write a fixed 400px inline style onto the
    // canvas. The stylesheet sizes the canvas to its wrapper
    // (width min(400px, 100%), aspect-ratio 1), which is what
    // lets the preview fit phone widths; the inline style used
    // to override that and push the codex to a 646px scroll
    // width inside a 412px screen.
    this.renderer.setSize(400, 400, false);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.camera.position.z = 100;
  }

  private renderEnemyPreview(enemy: any) {
    if (this.currentMesh) {
      this.scene.remove(this.currentMesh);
      this.currentMesh.geometry.dispose();
      (this.currentMesh.material as THREE.Material).dispose();
    }

    const isUnlocked = this.isUnlocked(enemy.id);
    // Shared entity builder (visual spec Section 3.1): the preview is
    // built by the same definition the game renders from, so the two
    // cannot drift apart. (The codex used to re-implement these shapes
    // by hand, with palettes the game itself never actually showed.)
    const built = buildEntityGeometry(enemy.id, {
      r: enemy.size / 2,
      hostile: WORLDS[0].themeData.palette.hostile,
    });
    const pos = built.positions;
    const col = built.colors;

    // Shadow colors if locked
    if (!isUnlocked) {
      for (let i = 0; i < built.count; i++) {
        const s = 0.05 + Math.random() * 0.05; // very dark gray outline
        col[i * 3] = s; col[i * 3 + 1] = s; col[i * 3 + 2] = s;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
        size: enemy.id === 'boss' ? 0.3 : 0.5,
        vertexColors: true,
        // Preview gain: builder palettes are tuned for the game's
        // additive stacking (roughly 15 to 30 sprites deep); this
        // preview stacks only about 4 deep, so the material color
        // multiplies the same builder colors back up to a comparable
        // read. Same data, per-surface gain.
        color: new THREE.Color(3, 3, 3),
        transparent: true,
        opacity: isUnlocked ? 0.9 : 0.5,
        blending: isUnlocked ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    
    this.currentMesh = new THREE.Points(geo, mat);
    
    // Scale camera to fit
    this.camera.position.z = Math.max(50, enemy.size * 2);
    
    this.scene.add(this.currentMesh);
  }

  private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    if (this.currentMesh) {
      this.currentMesh.rotation.y += 0.01;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
