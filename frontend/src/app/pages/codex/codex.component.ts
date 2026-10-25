import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService } from '../../services/game-state.service';
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
  
  realms = [
    { id: 1, name: 'Volcanic Crags', status: 'available' },
    { id: 2, name: 'Abyssal Depths', status: 'coming_soon' },
    { id: 3, name: 'Celestial Peaks', status: 'coming_soon' },
    { id: 4, name: 'Void Nexus', status: 'coming_soon' },
  ];

  realmOneEnemies = [
    { id: 'slime', name: 'Toxic Slime', desc: 'A bouncing mass of corrosive energy.', size: 20 },
    { id: 'bat', name: 'Vampiric Bat', desc: 'Fast, erratic flyer that haunts the crags.', size: 15 },
    { id: 'golem', name: 'Magma Golem', desc: 'A slow lumbering tank of molten rock.', size: 60 },
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
    this.renderer.setSize(400, 400);
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
    const count = enemy.id === 'boss' ? 4000 : 800;
    const r = enemy.size / 2;

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      let x = 0, y = 0, z = 0;

      if (enemy.id === 'slime') {
          const isCore = i < count * 0.3;
          const rad = isCore ? Math.cbrt(Math.random()) * r * 0.4 : Math.cbrt(Math.random()) * r;
          const u = Math.random() * Math.PI * 2;
          const v = Math.acos(Math.random());
          x = rad * Math.sin(v) * Math.cos(u);
          z = rad * Math.sin(v) * Math.sin(u);
          y = (rad * Math.cos(v) - r * 0.5) * (isCore ? 0.9 : 1.1);
          if (isUnlocked) {
              if (isCore) { col[idx] = 0.9; col[idx+1] = 1.0; col[idx+2] = 0.3; }
              else { col[idx] = 0.1; col[idx+1] = 0.8; col[idx+2] = 0.2; }
          }
      }
      else if (enemy.id === 'bat') {
          const p = Math.random();
          if (p < 0.2) {
              x = (Math.random() - 0.5) * 0.6 * r;
              y = (Math.random() - 0.5) * 0.8 * r;
              z = (Math.random() - 0.5) * 0.6 * r;
              if (isUnlocked) {
                  if (y > 0.2 * r && Math.abs(x) > 0.1 * r && z > 0.2 * r) { col[idx] = 1.0; col[idx+1] = 0.0; col[idx+2] = 0.0; }
                  else { col[idx] = 0.3; col[idx+1] = 0.0; col[idx+2] = 0.0; }
              }
          } else {
              const span = Math.random() * r * 2.5;
              const swoop = Math.sin((span / (r*2.5)) * Math.PI) * 0.5 * r;
              x = p < 0.6 ? -span : span;
              y = swoop + (Math.random() - 0.5) * 0.2 * r;
              z = (Math.random() - 0.5) * 0.3 * r - (span * 0.2);
              if (isUnlocked) {
                  col[idx] = 0.4; col[idx+1] = 0.0; col[idx+2] = 0.2;
              }
          }
      }
      else if (enemy.id === 'golem') {
          const p = Math.random();
          if (p < 0.2) {
              const rad = Math.cbrt(Math.random()) * r * 0.6;
              const u = Math.random() * Math.PI * 2;
              const v = Math.acos(2 * Math.random() - 1);
              x = rad * Math.sin(v) * Math.cos(u);
              y = rad * Math.sin(v) * Math.sin(u);
              z = rad * Math.cos(v);
              if (isUnlocked) { col[idx] = 1.0; col[idx+1] = 0.3; col[idx+2] = 0.0; }
          } else {
              const cx = (Math.random() - 0.5) * r * 2.5;
              const cy = (Math.random() - 0.5) * r * 3;
              const cz = (Math.random() - 0.5) * r * 2.5;
              x = cx + (Math.random() - 0.5) * 0.5 * r;
              y = cy + (Math.random() - 0.5) * 0.5 * r;
              z = cz + (Math.random() - 0.5) * 0.5 * r;
              if (isUnlocked) {
                  const g = 0.1 + Math.random() * 0.15;
                  col[idx] = g; col[idx+1] = g; col[idx+2] = g;
              }
          }
      }
      else if (enemy.id === 'boss') {
          const p = Math.random();
          if (p < 0.6) {
              const u = Math.random() * Math.PI * 2;
              const v = Math.acos(Math.random());
              const rad = r * 1.5 + (Math.random() - 0.5) * 0.3 * r;
              x = rad * Math.sin(v) * Math.cos(u);
              z = rad * Math.sin(v) * Math.sin(u);
              y = rad * Math.cos(v) + r * 0.5;
              if (isUnlocked) {
                  if (y > r * 0.8 && y < r * 1.5 && z > r * 0.5 && Math.abs(Math.abs(x) - r * 0.6) < r * 0.4) {
                      z -= r * 0.8; col[idx] = 1; col[idx+1] = 1; col[idx+2] = 1;
                  } else {
                      col[idx] = 1.0; col[idx+1] = 0.4; col[idx+2] = 0.0;
                  }
              }
          } else if (p < 0.85) {
              x = (Math.random() - 0.5) * r * 2.2;
              y = -r * 0.5 + (Math.random() - 0.5) * 0.4 * r;
              z = (Math.random() - 0.5) * r * 1.8 + (Math.abs(x) * 0.5);
              if (isUnlocked) { col[idx] = 0.8; col[idx+1] = 0.1; col[idx+2] = 0.0; }
          } else {
              const isLeft = Math.random() > 0.5;
              const t = Math.random();
              const spread = t * r * 1.5;
              x = isLeft ? -(r + spread) : (r + spread);
              y = r * 1.5 + t * r * 2 + (Math.random() - 0.5) * 0.3 * r;
              z = -t * r + (Math.random() - 0.5) * 0.3 * r;
              if (isUnlocked) { col[idx] = 1.0; col[idx+1] = 0.6 - t * 0.6; col[idx+2] = 0.0; }
          }
      }

      pos[idx] = x; pos[idx+1] = y; pos[idx+2] = z;

      // Shadow colors if locked
      if (!isUnlocked) {
          const s = 0.05 + Math.random() * 0.05; // very dark gray outline
          col[idx] = s; col[idx+1] = s; col[idx+2] = s;
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({ 
        size: enemy.id === 'boss' ? 0.3 : 0.5, 
        vertexColors: true, 
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
