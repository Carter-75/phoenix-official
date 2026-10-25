import { Component, ElementRef, OnInit, OnDestroy, ViewChild, NgZone, effect, inject } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { WORLDS } from '../../constants/game.constants';
import { PhysicsEntity } from '../../models/game.models';
import * as THREE from 'three';

interface PhoenixState {
  theme: string;
  group: THREE.Group;
  particles: THREE.Points;
  basePositions: Float32Array;
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

  private mouseTarget = new THREE.Vector3(0, -10, -15);
  private entityPool = new Map<string, ParticleEntity>();
  
  constructor(private ngZone: NgZone) {
    effect(() => {
      const worldIndex = this.gameState.selectedWorldIndex();
      const theme = WORLDS[worldIndex].theme;
      this.updateColors(theme);
    });
  }
  
  ngOnInit() {
    this.initThree();
    this.createParticles();
    this.createCosmetics();
    
    this.bird = this.createBirdState('orange');
    this.initHistory(this.bird);
    this.createPhoenixMesh(this.bird);
    
    this.aiBird = this.createBirdState('crimson'); // Different theme for AI
    this.initHistory(this.aiBird);
    this.createPhoenixMesh(this.aiBird);
    
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

    const aColors = this.particles.geometry.attributes['color'].array as Float32Array;
    for (let i = 0; i < aColors.length; i += 3) {
      const r = Math.random();
      if (r > 0.66) { aColors[i] = p1[0]; aColors[i+1] = p1[1]; aColors[i+2] = p1[2]; }
      else if (r > 0.33) { aColors[i] = p2[0]; aColors[i+1] = p2[1]; aColors[i+2] = p2[2]; }
      else { aColors[i] = p3[0]; aColors[i+1] = p3[1]; aColors[i+2] = p3[2]; }
    }
    this.particles.geometry.attributes['color'].needsUpdate = true;

    const bColors = this.bird.particles.geometry.attributes['color'].array as Float32Array;
    const positions = this.bird.particles.geometry.attributes['position'].array as Float32Array;
    const count = this.bird.phoenixCount;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const x = positions[idx];
      const z = positions[idx+2];
      const distFromCenter = Math.sqrt(x*x + z*z);
      
      if (distFromCenter < 2 && z < 2) { bColors[idx] = p1[0]; bColors[idx+1] = p1[1]; bColors[idx+2] = p1[2]; }
      else if (distFromCenter < 5 && z < 6) { bColors[idx] = p2[0]; bColors[idx+1] = p2[1]; bColors[idx+2] = p2[2]; }
      else { bColors[idx] = p3[0]; bColors[idx+1] = p3[1]; bColors[idx+2] = p3[2]; }
    }
    this.bird.particles.geometry.attributes['color'].needsUpdate = true;

    // AI Bird uses Crimson theme statically to differentiate
    const aiColors = this.aiBird.particles.geometry.attributes['color'].array as Float32Array;
    const aiPositions = this.aiBird.particles.geometry.attributes['position'].array as Float32Array;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const x = aiPositions[idx];
      const z = aiPositions[idx+2];
      const distFromCenter = Math.sqrt(x*x + z*z);
      
      if (distFromCenter < 2 && z < 2) { aiColors[idx] = 1.0; aiColors[idx+1] = 0.2; aiColors[idx+2] = 0.2; }
      else if (distFromCenter < 5 && z < 6) { aiColors[idx] = 0.8; aiColors[idx+1] = 0.0; aiColors[idx+2] = 0.0; }
      else { aiColors[idx] = 0.5; aiColors[idx+1] = 0.0; aiColors[idx+2] = 0.0; }
    }
    this.aiBird.particles.geometry.attributes['color'].needsUpdate = true;


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
      theme, group: new THREE.Group(), particles: new THREE.Points(), basePositions: new Float32Array(0),
      phoenixCount: 4000, currentBank: 0, flapTime: 0, position: new THREE.Vector3(0, -5, -15),
      velocity: new THREE.Vector3(0, 1, 0), previousVelocity: new THREE.Vector3(0, 1, 0),
      targetWaypoint: new THREE.Vector3(), historyPos: [], historyQuat: []
    };
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
    this.birdScale = Math.max(0.15, Math.min(0.4, window.innerWidth / 1500));
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const height = 2 * Math.tan(vFOV / 2) * Math.abs(this.camera.position.z + 15);
    this.boundY = height / 2;
    this.boundX = (height * this.camera.aspect) / 2;
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
    const speed = 0.06; 
    const startVel = startDir.clone().multiplyScalar(speed);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.MAX_HISTORY; i++) {
        const p = startPos.clone().sub(startDir.clone().multiplyScalar(i * speed));
        bird.historyPos.push(p);
        dummy.position.copy(p);
        dummy.lookAt(p.clone().add(startVel));
        dummy.rotateY(Math.PI);
        bird.historyQuat.push(dummy.quaternion.clone());
    }
    bird.position.copy(startPos);
    bird.velocity.copy(startVel);
    this.mouseTarget.copy(startPos);
  }

  private createPhoenixMesh(bird: PhoenixState) {
    const geometry = new THREE.BufferGeometry();
    bird.basePositions = new Float32Array(bird.phoenixCount * 3);
    const positions = new Float32Array(bird.phoenixCount * 3);
    const colors = new Float32Array(bird.phoenixCount * 3);
    for (let i = 0; i < bird.phoenixCount; i++) {
      const idx = i * 3;
      let x = 0, y = 0, z = 0;
      let rand = Math.random();
      if (rand < 0.5) { x = (Math.random() - 0.5) * 20; z = 0.05 * (x * x) + Math.random() * 1.5 + 4; y = Math.sin(Math.abs(x) * 0.3) * 1.5 + (Math.random() - 0.5) * 0.1; }
      else if (rand < 0.7) { const u = Math.random() * Math.PI * 2; const v = Math.acos(2 * Math.random() - 1); const r = Math.cbrt(Math.random()); x = r * Math.sin(v) * Math.cos(u) * 0.8; y = r * Math.sin(v) * Math.sin(u) * 0.8; z = r * Math.cos(v) * 3 + 6; }
      else if (rand < 0.85) { z = Math.random() * 4; let radius = 0; if (z < 0.8) radius = z * 0.3; else if (z < 1.8) radius = 0.6 - Math.abs(z - 1.3) * 0.4; else radius = 0.2 + (z - 1.8) * 0.1; const angle = Math.random() * Math.PI * 2; x = Math.cos(angle) * Math.random() * radius; y = Math.sin(angle) * Math.random() * radius; }
      else { const feather = Math.floor(Math.random() * 5); z = 9 + Math.random() * 16; x = (feather - 2) * (z - 9) * 0.15 + (Math.random() - 0.5) * 0.2; y = -Math.pow(Math.abs(z - 9), 1.1) * 0.15 + (Math.random() - 0.5) * 0.2; }
      z += (Math.random() - 0.5) * 0.5; if (z < 0) z = 0; const scale = 0.4;
      bird.basePositions[idx] = x * scale; bird.basePositions[idx+1] = y * scale; bird.basePositions[idx+2] = z * scale;
      positions[idx] = x; positions[idx+1] = y; positions[idx+2] = z;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    bird.particles = new THREE.Points(geometry, material);
    bird.particles.frustumCulled = false; 
    bird.group = new THREE.Group();
    bird.group.add(bird.particles);
    this.scene.add(bird.group);
  }

  private animate() {
    this.ngZone.runOutsideAngular(() => {
      const render = () => {
        // Ambient particles moving downward
        const positions = this.particles.geometry.attributes['position'].array as Float32Array;
        const halfBox = this.ambientBoxSize / 2;
        for (let i = 0; i < positions.length; i += 3) {
          positions[i+1] -= 0.03; 
          if (positions[i+1] < -halfBox) { positions[i+1] = halfBox; positions[i] = (Math.random() - 0.5) * this.ambientBoxSize; }
        }
        this.particles.geometry.attributes['position'].needsUpdate = true;
        this.particles.rotation.y += 0.0001;

        const screenFactor = Math.max(1.0, 1000 / (window.innerWidth || 1000));
        const speed = 0.068 * screenFactor;  
        
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
        
        this.updateBirdPhysics(this.bird, targetForMainBird, speed, screenFactor, false);
        
        // Hide AI Bird if not in battle mode or not playing
        const isBattle = (this.gameState.currentGameMode() === 'battle' || this.gameState.currentGameMode() === 'ai_vs_ai') && this.gameState.activeScreen() === 'game';
        this.aiBird.group.visible = isBattle;
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
            const aiTarget3D = this.camera.position.clone().add(aiVec.multiplyScalar(dist));
            
            this.updateBirdPhysics(this.aiBird, aiTarget3D, speed, screenFactor, true);
        }

        this.syncEntities();

        this.renderer.render(this.scene, this.camera);
        
        this.wasGameScreen = this.gameState.activeScreen() === 'game';
        this.animationId = requestAnimationFrame(render);
      };
      render();
    });
  }

  private wasGameScreen = false;

  private updateBirdPhysics(bird: PhoenixState, targetWaypoint: THREE.Vector3, speed: number, screenFactor: number, isAi: boolean) {
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
                      mat.opacity = Math.floor(Date.now() / 250) % 2 === 0 ? 0.1 : 0.9;
                  } else {
                      mat.opacity = 0.9;
                  }
              }

              bird.flapTime += 0.04;
              
              bird.targetWaypoint.lerp(targetWaypoint, 0.1);

              const directToTarget = bird.targetWaypoint.clone().sub(bird.position);
              
              if (directToTarget.lengthSq() < 0.1) {
                directToTarget.set(0,0,0);
              } else {
                directToTarget.normalize().multiplyScalar(0.015);
              }

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

              const maxTurnForce = (0.002 / this.birdScale) * speedMult * screenFactor; 
              const desiredVelocity = bird.velocity.clone().add(directToTarget.multiplyScalar(speedMult)).normalize().multiplyScalar(speed * speedMult);
              const steering = desiredVelocity.sub(bird.velocity);
              if (steering.length() > maxTurnForce) steering.normalize().multiplyScalar(maxTurnForce);
              bird.velocity.add(steering);
              if (bird.velocity.lengthSq() > 0) bird.velocity.normalize().multiplyScalar(speed);
              
              bird.position.add(bird.velocity);
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
            dummy.quaternion.copy(bird.historyQuat[0]).slerp(targetQuat, 0.075);
        } else {
            dummy.quaternion.copy(targetQuat);
        }

        const vDiff = bird.velocity.clone().sub(bird.previousVelocity);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(dummy.quaternion);
        let targetBank = vDiff.dot(right) * 600; 
        targetBank = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, targetBank));
        
        if (!isAi && this.gameState.isDrilling()) {
            bird.currentBank += 0.5;
        } else {
            bird.currentBank += (targetBank - bird.currentBank) * 0.025;
        }
        
        dummy.rotateZ(bird.currentBank);
        bird.previousVelocity.copy(bird.velocity);

        bird.historyPos.unshift(bird.position.clone());
        bird.historyQuat.unshift(dummy.quaternion.clone());
        if (bird.historyPos.length > this.MAX_HISTORY) {
            bird.historyPos.pop(); bird.historyQuat.pop();
        }

        if (!this.gameState.isPaused() && (!this.gameState.isRebirthing() || isAi)) {
            bird.flapTime += 0.04;
        }
        const pPositions = bird.particles.geometry.attributes['position'].array as Float32Array;
        
        if (!isAi && this.gameState.isRebirthing()) {
            for (let k = 0; k < bird.phoenixCount; k++) {
                const idx = k * 3;
                pPositions[idx] += (Math.random() - 0.5) * 0.05;
                pPositions[idx+1] -= Math.random() * 0.1;
                pPositions[idx+2] += (Math.random() - 0.5) * 0.05;
            }
        } else {
            for (let k = 0; k < bird.phoenixCount; k++) {
              const idx = k * 3;
              const baseX = bird.basePositions[idx];
              const baseY = bird.basePositions[idx+1];
              const baseZ = bird.basePositions[idx+2];
              
              const scaledBaseX = baseX * this.birdScale;
              const scaledBaseY = baseY * this.birdScale;
              const scaledBaseZ = baseZ * this.birdScale;
              
              let histIdx = Math.floor(scaledBaseZ / speed);
              histIdx = Math.max(0, Math.min(bird.historyPos.length - 1, histIdx));
              
              const hPos = bird.historyPos[histIdx];
              const hQuat = bird.historyQuat[histIdx];
              
              const flapAmount = Math.abs(scaledBaseX) * 0.5; 
              const flapPhase = bird.flapTime - scaledBaseZ * 2.0; 
              const flapOffset = Math.sin(flapPhase) * flapAmount;
              
              const flickerX = (Math.random() - 0.5) * 0.05 * this.birdScale;
              const flickerY = (Math.random() - 0.5) * 0.05 * this.birdScale;
              
              const localOffset = new THREE.Vector3(scaledBaseX + flickerX, scaledBaseY + flapOffset + flickerY, 0);
              localOffset.applyQuaternion(hQuat);
              
              let finalX = hPos.x + localOffset.x;
              const wrapWidth = this.boundX * 2 + 10;
              
              if (finalX > wrapWidth / 2) {
                finalX -= wrapWidth;
              } else if (finalX < -wrapWidth / 2) {
                finalX += wrapWidth;
              }

              pPositions[idx] = finalX;
              pPositions[idx+1] = hPos.y + localOffset.y;
              pPositions[idx+2] = hPos.z + localOffset.z;
            }
        }
        bird.particles.geometry.attributes['position'].needsUpdate = true;
        
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
                    targetPos.lerp(bird.position, 0.1);
                    this.celestialShieldMesh.position.copy(targetPos);
                    this.celestialShieldMesh.rotation.y += 0.01;
                    this.celestialShieldMesh.rotation.x += 0.005;
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
          const bColors = this.bird.particles.geometry.attributes['color'].array as Float32Array;
          col[idx] = bColors[idx];
          col[idx+1] = bColors[idx+1];
          col[idx+2] = bColors[idx+2];
      } else if (data.type === 'enemy_phoenix' && this.bird) {
          const bColors = this.bird.particles.geometry.attributes['color'].array as Float32Array;
          col[idx] = 1.0 - bColors[idx];
          col[idx+1] = 1.0 - bColors[idx+1];
          col[idx+2] = 1.0 - bColors[idx+2];
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
