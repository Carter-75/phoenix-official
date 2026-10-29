// Entity render sync: mirrors the Matter physics entities into the
// Three scene each frame (pooled point clouds, hit flash envelopes,
// death bursts, entity mesh creation). Owns no state of its own; it
// reads and writes the component's render state through the host
// interface. Moved out of particle-bg.component.ts in the code
// organization pass (Oct 27, 2026); logic unchanged.
import * as THREE from 'three';
import { GameStateService } from '../../services/game-state.service';
import { PhysicsEntity, WorldTheme } from '../../models/game.models';
import { WORLDS, HOSTILE_RGB } from '../../constants/game.constants';
import { buildEntityGeometry } from './entity-builder';
import { MOB_SPRITE_TYPES, getMobSpriteSet, getBossFormSets, getBoltSpriteSet, PICKUP_SPRITE_TYPES, getPickupSpriteSet } from './mob-sprite';
import { bossDefFor } from '../../data/boss-rig';
import { PhoenixState, ParticleEntity, DyingBurst } from './phoenix-state';
import { Rgb3 } from './phoenix-skins';

export interface EntitySyncHost {
  bird: PhoenixState;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gameState: GameStateService;
  entityPool: Map<string, ParticleEntity>;
  dyingBursts: DyingBurst[];
  lastSyncMs: number;
  fullAnimIds: Set<string>;
  birdColorAt(bird: PhoenixState, k: number): Rgb3;
  heartBeatScale(timeOffset: number): number;
}

// Player uniquely brightest (visual spec rule 1, final sweep; the
// S6 readability audit's open item): at the two larger viewports a
// max-brightness foe disc could tie the player (246 vs 247 at
// 412x915, 250 vs 252 at 1280x800), because several foe palettes
// carry near-white cores whose perceived luminance reaches the
// player bird's peak. Enemy-family geometry is therefore clamped
// at build: any vertex color whose perceived luminance exceeds
// the cap is scaled down proportionally, so hues survive intact
// and only the white-hot cores come down. The cap started at
// 0.85 against the S6 tie measurements; the sweep's first
// readability pass moved the foe disc peaks only about a tenth,
// inside the sandbox's sampling noise, so the cap was tightened
// to 0.70, where the brightest authored foe cores (luminance
// about 0.93 to 0.97) scale by roughly 0.72 to 0.75 and the
// margin stands clear of the noise (before and after disc
// medians are recorded in FINAL-SWEEP.md). Pickups
// are exempt (their identity read IS their vivid color), as are
// the player's own turret and its egg. Projectiles, zones, and
// effect blobs never exceed the cap in their shipped palettes, so
// applying the clamp to every non-exempt build is a no-op for
// them; per-frame writers (hit flash, charge glows) are transient
// feedback and stay outside this steady-state rule.
export const FOE_LUMINANCE_CAP = 0.70;
const FOE_CLAMP_EXEMPT = new Set(['coin', 'heart', 'gem', 'xp_orb', 'spark_cell', 'overcharge', 'turret', 'egg', 'crate']);
export function clampFoeLuminance(colors: Float32Array): void {
  for (let i = 0; i + 2 < colors.length; i += 3) {
    const lum = 0.2126 * colors[i] + 0.7152 * colors[i + 1] + 0.0722 * colors[i + 2];
    if (lum > FOE_LUMINANCE_CAP) {
      const s = FOE_LUMINANCE_CAP / lum;
      colors[i] *= s; colors[i + 1] *= s; colors[i + 2] *= s;
    }
  }
}

export class EntitySync {
  constructor(private host: EntitySyncHost) {}

  // Enemy types get the shared death burst on removal (Section 3.1);
  // everything else (pickups, projectiles, effects) just disappears.
  private static readonly BURST_TYPES = ['slime', 'bat', 'golem', 'imp', 'wisp', 'pod', 'mite', 'sentry_shard', 'seedmother', 'rift_mine', 'shieldback', 'pyre_moth', 'phantom', 'wraith', 'chanter', 'serpent', 'darter', 'boss'];

syncEntities() {
    const nowMs = performance.now();
    const dtSec = this.host.lastSyncMs ? Math.min(0.1, (nowMs - this.host.lastSyncMs) / 1000) : 1 / 60;
    this.host.lastSyncMs = nowMs;

    const active = this.host.gameState.activeEntities();
    const activeIds = new Set(active.map(e => e.id));

    // Animation budget (visual spec Section 1.4): full vertex
    // animation for the boss and the nearest 6 enemies; every other
    // enemy renders transform-only (mesh position, rotation, scale),
    // which is what keeps a full 12-enemy field inside the frame
    // budget. Distances use last frame's mesh positions against the
    // bird's position; one frame of staleness is invisible here.
    this.host.fullAnimIds.clear();
    if (this.host.bird) {
      const bp = this.host.bird.position;
      const foes: { id: string; d: number; boss: boolean }[] = [];
      for (const e of active) {
        if (!EntitySync.BURST_TYPES.includes(e.type)) continue;
        const pooled = this.host.entityPool.get(e.id);
        const d = pooled ? pooled.mesh.position.distanceToSquared(bp) : Number.MAX_SAFE_INTEGER;
        foes.push({ id: e.id, d, boss: e.type === 'boss' });
      }
      foes.sort((a, b) => a.d - b.d);
      for (const f of foes.slice(0, 6)) this.host.fullAnimIds.add(f.id);
      for (const f of foes) if (f.boss) this.host.fullAnimIds.add(f.id);
    }

    // Remove dead entities
    for (const [id, entity] of this.host.entityPool.entries()) {
      if (!activeIds.has(id)) {
        if (entity.sprite) {
          // Drawn mob death (A5): the sprite dies in a burst of
          // points sampled from its own drawing, then the plane is
          // disposed (textures are cached in mob-sprite and shared,
          // so only the plane geometry and material go).
          const spr = entity.sprite;
          if (EntitySync.BURST_TYPES.includes(entity.type) && spr.set.burstPositions.length > 0) {
            const bGeo = new THREE.BufferGeometry();
            bGeo.setAttribute('position', new THREE.BufferAttribute(spr.set.burstPositions.slice(), 3));
            bGeo.setAttribute('color', new THREE.BufferAttribute(spr.set.burstColors.slice(), 3));
            const bMat = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
            const burstMesh = new THREE.Points(bGeo, bMat);
            burstMesh.position.copy(entity.mesh.position);
            burstMesh.frustumCulled = false;
            this.host.scene.add(burstMesh);
            this.host.dyingBursts.push({
              mesh: burstMesh,
              positions: spr.set.burstPositions.slice(),
              colors: spr.set.burstColors.slice(),
              startMs: nowMs,
            });
          }
          this.host.scene.remove(entity.mesh);
          entity.mesh.geometry.dispose();
          (entity.mesh.material as THREE.Material).dispose();
        } else if (EntitySync.BURST_TYPES.includes(entity.type)) {
          // Death burst: keep the mesh on screen with a snapshot of its
          // animated shape; updateDyingBursts scatters and cools it.
          this.host.dyingBursts.push({
            mesh: entity.mesh as THREE.Points,
            positions: (entity.mesh.geometry.attributes['position'].array as Float32Array).slice(),
            colors: (entity.mesh.geometry.attributes['color'].array as Float32Array).slice(),
            startMs: nowMs,
          });
        } else {
          this.host.scene.remove(entity.mesh);
          entity.mesh.geometry.dispose();
          (entity.mesh.material as THREE.Material).dispose();
        }
        this.host.entityPool.delete(id);
      }
    }

    // Add/Update active entities
    for (const data of active) {
      if (data.type === 'enemy_phoenix') continue; // Handled by aiBird
      
      let entity = this.host.entityPool.get(data.id);
      if (!entity) {
        entity = this.createEntityMesh(data);
        this.host.scene.add(entity.mesh);
        this.host.entityPool.set(data.id, entity);
      }

      // Unproject 2D to 3D
      const vec = new THREE.Vector3(
        (data.x / window.innerWidth) * 2 - 1,
        -(data.y / window.innerHeight) * 2 + 1,
        0.5
      );
      vec.unproject(this.host.camera);
      vec.sub(this.host.camera.position).normalize();
      const distance = (-15 - this.host.camera.position.z) / vec.z;
      const pos3d = this.host.camera.position.clone().add(vec.multiplyScalar(distance));
      
      entity.mesh.position.copy(pos3d);

      // Animation budget state for this frame (Section 1.4): enemies
      // outside the nearest 6 skip per-vertex animation. On the
      // transition into budget mode, restore the built pose once so
      // the frozen frame (and any later death burst snapshot) uses
      // the clean builder shape.
      const budgeted = !!this.host.bird
        && EntitySync.BURST_TYPES.includes(data.type)
        && !this.host.fullAnimIds.has(data.id);
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

      // Rotate for visual effect (points entities only: drawn
      // sprites own their transforms in updateSpriteEntity, and a
      // plane must never tumble around the y axis).
      if (!entity.sprite && data.type === 'coin') {
        entity.mesh.rotation.y += 0.1;
      } else if (!entity.sprite && data.type === 'flame_tornado') {
        // The vortex spin (final sweep): the builder lays the zone's
        // points on a spiral, and rotating the mesh in the screen
        // plane is what makes it read as turning.
        entity.mesh.rotation.z -= 0.12;
      } else if (!entity.sprite && data.type === 'heart') {
        const beat = 1 + Math.sin(Date.now() * 0.01) * 0.2;
        entity.mesh.scale.set(beat, beat, beat);
      } else if (!entity.sprite && (data.type === 'gem' || data.type === 'xp_orb' || data.type === 'spark_cell' || data.type === 'overcharge')) {
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
      if (!entity.sprite && EntitySync.BURST_TYPES.includes(data.type) && entity.bornMs !== undefined) {
        const age = (nowMs - entity.bornMs) / 300;
        (entity.mesh.material as THREE.PointsMaterial).opacity = age >= 1 ? 0.9 : 0.9 * Math.max(0, age);
      }

      // Complex Vertex Animations
      if (entity.sprite) {
        // Drawn mobs (A5): all per-type motion is transform and
        // material level (turning, squish, swell, spin, tints,
        // opacity reads), computed from the same published state
        // the vertex branches below consume.
        this.updateSpriteEntity(entity, data, nowMs, dtSec, flashEnv);
      }
      else if (data.type === 'slime' && entity.basePositions) {
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
          const beat = this.host.gameState.selectedWorldIndex() === 8 ? this.host.heartBeatScale(entity.timeOffset || 0) : 1;
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
          const s = this.host.gameState.selectedWorldIndex() === 8
            ? this.host.heartBeatScale(entity.timeOffset || 0)
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
      else if (data.type === 'boss_shield') {
        // The shield shell (Stage 9): a slow rotation and an opacity
        // that follows the published charge (gather progress while
        // the telegraph runs, shield strength while it holds). The
        // shell stays translucent: the boss and its telegraphs read
        // through it.
        entity.mesh.rotation.y += 0.6 * dtSec;
        (entity.mesh.material as THREE.PointsMaterial).opacity = 0.16 + 0.30 * (data.attackCharge ?? 0);
      }
      else if (data.type === 'boss_ring' || data.type === 'boss_pillar' || data.type === 'boss_column') {
        // Signature telegraphs (Stage 9): hostile geometry that
        // brightens as its telegraph completes and burns at full
        // strength while the hazard is live. These branches own
        // their opacity every frame.
        (entity.mesh.material as THREE.PointsMaterial).opacity = 0.25 + 0.7 * (data.attackCharge ?? 0);
      }
      else if (data.type === 'boss_arc') {
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        (entity.mesh.material as THREE.PointsMaterial).opacity = 0.25 + 0.7 * (data.attackCharge ?? 0);
      }
      else if (data.type === 'boss_line' || data.type === 'boss_cone') {
        // Stage 10 telegraphs: the locked dash line and the
        // Emperor's breath cone, rotated to their published facing
        // and brightening with their charge, like the arc.
        if (data.facing !== undefined) entity.mesh.rotation.z = -data.facing;
        (entity.mesh.material as THREE.PointsMaterial).opacity = 0.25 + 0.7 * (data.attackCharge ?? 0);
      }
      else if (data.type === 'boss_shadow') {
        // Shadow Split copies (Stage 9): dimmer than the real boss
        // by build and by opacity; the difference is the tell.
        (entity.mesh.material as THREE.PointsMaterial).opacity = 0.55;
      }
      else if (data.type === 'boss_shard') {
        entity.mesh.rotation.y += 2.2 * dtSec;
        entity.mesh.rotation.x += 0.9 * dtSec;
      }
      else if (data.type === 'boss' && entity.basePositions) {
        const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
        const time = Date.now() * 0.005 + (entity.timeOffset || 0);
        const jawOpen = (Math.sin(time * 0.5) * 0.5 + 0.5) * 0.3 * (data.size/30);
        // Chaos Demon forms (Stage 10): while a form flows in, the
        // points lerp from the previous form's geometry to the
        // current one; the three forms were built at mesh creation.
        const forms = entity.formGeos;
        const formIdx = data.bossForm ?? 0;
        const flow = data.bossFormFlow ?? 1;
        const prevIdx = (formIdx + 2) % 3;
        for(let i=0; i<pPositions.length; i+=3) {
            let bx = entity.basePositions[i];
            let by = entity.basePositions[i+1];
            let bz = entity.basePositions[i+2];
            if (forms) {
                const a = forms[prevIdx].positions, b = forms[formIdx].positions;
                bx = a[i] + (b[i] - a[i]) * flow;
                by = a[i+1] + (b[i+1] - a[i+1]) * flow;
                bz = a[i+2] + (b[i+2] - a[i+2]) * flow;
            }
            pPositions[i] = bx;
            pPositions[i+1] = by < 0 ? by - jawOpen : by; // Jaw drops
            pPositions[i+2] = bz;
        }
        entity.mesh.geometry.attributes['position'].needsUpdate = true;
        // The slow ominous spin belongs to the skull (World 1);
        // every other boss body holds its facing and only wobbles
        // (Stage 10 removed the spin from Worlds 6 to 10, whose
        // placeholder skulls it used to turn).
        const wi = this.host.gameState.selectedWorldIndex();
        if (wi === 0) entity.mesh.rotation.y -= 0.02;
        entity.mesh.rotation.z = Math.sin(time * 0.2) * 0.1; // Float wobble
        // Rig charge (Stage 9): telegraph progress, the enrage
        // warning build, and the enraged pulse all brighten the
        // core layer, per the enrage addendum's visuals (glow build
        // and a brighter enraged core, telegraphs untouched).
        const charge = data.attackCharge ?? 0;
        // Singularity collapse (Stage 10): during its telegraph the
        // Eternal Phoenix shrinks toward a point of light.
        entity.mesh.scale.setScalar(data.state === 'singularity' ? 1 - 0.7 * charge : 1);
        // The King's ash (Stage 10): the collapsed boss reads as a
        // dim gray ghost of itself while the arena holds.
        (entity.mesh.material as THREE.PointsMaterial).opacity = data.state === 'ashen' ? 0.38 : 0.9;
        if (entity.baseColors && entity.layerFlags) {
          const colAttr = entity.mesh.geometry.attributes['color'];
          const colArr = colAttr.array as Float32Array;
          const brighten = 1 + charge * 1.1;
          const wash = data.wash;
          const ashen = data.state === 'ashen';
          for (let i = 0; i < entity.layerFlags.length; i++) {
            const idx = i * 3;
            let cr = entity.baseColors[idx], cg = entity.baseColors[idx + 1], cb = entity.baseColors[idx + 2];
            // Chaos forms carry their own accent colors; flow the
            // colors with the positions.
            if (forms) {
              const ca = forms[prevIdx].colors, cbk = forms[formIdx].colors;
              cr = ca[idx] + (cbk[idx] - ca[idx]) * flow;
              cg = ca[idx + 1] + (cbk[idx + 1] - ca[idx + 1]) * flow;
              cb = ca[idx + 2] + (cbk[idx + 2] - ca[idx + 2]) * flow;
            }
            // Chaos Roulette wash (Stage 10): the whole body takes
            // the announced pattern's color for the telegraph.
            if (wash) { cr = cr * 0.55 + wash[0] * 0.45; cg = cg * 0.55 + wash[1] * 0.45; cb = cb * 0.55 + wash[2] * 0.45; }
            if (ashen) { const g = (cr + cg + cb) / 3 * 0.7; cr = g; cg = g; cb = g * 1.05; }
            if (entity.layerFlags[i] === 1) {
              cr = Math.min(1.8, cr * brighten); cg = Math.min(1.8, cg * brighten); cb = Math.min(1.8, cb * brighten);
            }
            colArr[idx] = cr; colArr[idx + 1] = cg; colArr[idx + 2] = cb;
          }
          colAttr.needsUpdate = true;
        }
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
        if (this.host.bird && this.host.bird.basePositions) {
            const pPositions = entity.mesh.geometry.attributes['position'].array as Float32Array;
            const r = data.size / 30;
            const scaleFactor = data.type === 'enemy_phoenix' ? 1.0 : 0.4;
            for (let i = 0; i < 4000; i++) {
                 const idx = i * 3;
                 if (this.host.bird.basePositions.length > idx + 2) {
                     const baseX = this.host.bird.basePositions[idx];
                     const baseY = this.host.bird.basePositions[idx+1];
                     const baseZ = this.host.bird.basePositions[idx+2];
                     
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
      // Drawn sprites compose the buff tint inside
      // updateSpriteEntity, so the generic wash skips them (it
      // would reset their per-frame tints every frame).
      if (!entity.sprite) {
        const pubMat = entity.mesh.material as THREE.PointsMaterial;
        if (data.buffed) {
          pubMat.color.setRGB(1.35, 0.55, 0.75);
        } else if (pubMat.color.r !== 1 || pubMat.color.g !== 1 || pubMat.color.b !== 1) {
          pubMat.color.setRGB(1, 1, 1);
        }
      }

      // Make aura expand dynamically
      if (data.type === 'aura') {
        entity.mesh.rotation.z += 0.1;
      }
    }

    this.updateDyingBursts(nowMs);
  }

  // Drawn mob per-frame update (A5). Everything the vertex
  // branches do with points, the sprite does with transforms and
  // material state, driven by the same published fields: facing
  // for the aimed types, attackCharge for the telegraphs, state
  // for the phase reads, wash and bossForm for the Chaos Demon
  // and the roulette wash. Hit flash whitens the material; the
  // Chanter buff tint composes here instead of the generic wash.
  private static readonly SPRITE_TURN_TYPES = new Set(['sentry_shard', 'shieldback', 'wraith', 'serpent', 'darter']);

updateSpriteEntity(entity: ParticleEntity, data: PhysicsEntity, nowMs: number, dtSec: number, flashEnv: number): void {
    const spr = entity.sprite!;
    const mesh = entity.mesh as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const t = Date.now();
    const off = entity.timeOffset || 0;
    const charge = data.attackCharge ?? 0;
    // A sprite plane only ever turns in the screen plane.
    mesh.rotation.x = 0;
    mesh.rotation.y = 0;

    // Heading: player bolts read their travel velocity directly;
    // published facing wins for the aimed types; the boss faces
    // the player; everyone else turns by their motion.
    let heading = spr.heading;
    if (data.type === 'projectile_player' && (data.vx || data.vy)) {
      heading = Math.atan2(data.vy!, data.vx!);
    } else if (typeof data.facing === 'number') {
      heading = data.facing;
    } else if ((data.type === 'boss' || data.type === 'boss_shadow') && this.host.bird) {
      const dx = this.host.bird.position.x - mesh.position.x;
      const dy = -(this.host.bird.position.y - mesh.position.y);
      if (dx * dx + dy * dy > 0.0004) heading = Math.atan2(dy, dx);
    } else {
      const dx = mesh.position.x - spr.prevX;
      const dy = -(mesh.position.y - spr.prevY);
      if (dx * dx + dy * dy > 0.000001) heading = Math.atan2(dy, dx);
    }
    spr.prevX = mesh.position.x;
    spr.prevY = mesh.position.y;
    let dh = heading - spr.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    // Bolts snap to their travel direction (they spawn moving);
    // mobs ease into theirs.
    spr.heading += dh * (data.type === 'projectile_player' ? 1 : Math.min(1, dtSec * 12));
    heading = spr.heading;

    // Rotation: only the aimed types turn (drawn facing up, so a
    // screen heading (dx, dy) maps to rotation atan2(-dx, -dy)).
    // The Golem's rock orbit becomes a whole-body spin at the
    // shipped orbit rate; the Wisp ring and the Chanter spark
    // ring rotate slowly so their gaps travel.
    if (EntitySync.SPRITE_TURN_TYPES.has(data.type) || data.type === 'projectile_player') {
      mesh.rotation.z = Math.atan2(-Math.cos(heading), -Math.sin(heading));
    } else if (data.type === 'golem') {
      entity.orbitAngle = (entity.orbitAngle || 0) + dtSec * 0.96 * (1 + 2.2 * charge * charge);
      mesh.rotation.z = entity.orbitAngle;
    } else if (data.type === 'wisp') {
      mesh.rotation.z = t * 0.0011 + off;
    } else if (data.type === 'chanter') {
      mesh.rotation.z = t * 0.0007 + off;
    } else if (data.type === 'coin') {
      // Pickups (A12): the coin turns in the screen plane; the
      // orb family rocks gently; hearts and crates stay upright.
      mesh.rotation.z = t * 0.0016 + off;
    } else if (data.type === 'gem' || data.type === 'xp_orb' || data.type === 'spark_cell' || data.type === 'overcharge') {
      mesh.rotation.z = Math.sin(t * 0.002 + off) * 0.18;
    } else {
      mesh.rotation.z = 0;
    }

    // Scale reads (squish, swell, heartbeat, breathing).
    let ux = 1, uy = 1;
    if (data.type === 'slime') {
      const squish = Math.sin(t * 0.005 + off) * 0.3;
      uy = 1 + squish * 0.45; ux = 1 - squish * 0.18;
    } else if (data.type === 'pod') {
      let u = this.host.heartBeatScale(off);
      if (data.maxHealth && data.health !== undefined) u *= 0.82 + 0.18 * Math.max(0, data.health / data.maxHealth);
      ux = uy = u;
    } else if (data.type === 'imp') {
      ux = uy = 1 + 0.28 * charge;
    } else if (data.type === 'chanter') {
      ux = uy = 1 + 0.05 * Math.sin(t * 0.003 + off);
    } else if (data.type === 'seedmother') {
      ux = uy = 1 + 0.04 * Math.sin(t * 0.002 + off);
      mesh.position.y += Math.sin(t * 0.0016 + off) * 0.035;
    } else if (data.type === 'serpent') {
      if ((data as any).weave === 'coil') { ux = uy = 1.12; }
    } else if (data.type === 'heart') {
      // The shipped heartbeat, carried to the drawn heart.
      ux = uy = 1 + Math.sin(t * 0.01) * 0.2;
    } else if (data.type === 'boss') {
      if (data.bossFormFlow !== undefined && data.bossFormFlow < 1) {
        ux = uy = 1 + 0.08 * Math.sin(data.bossFormFlow * Math.PI);
      }
    }
    mesh.scale.set(spr.baseScaleX * ux, spr.baseScaleY * uy, 1);

    // Chaos Demon forms: swap the drawn body at the form switch.
    if (spr.sets.length > 1 && data.bossForm !== undefined && spr.sets[data.bossForm] && spr.set !== spr.sets[data.bossForm]) {
      spr.set = spr.sets[data.bossForm];
      mat.map = spr.set.maps[0];
      mat.needsUpdate = true;
    }
    // Flap frames (bat, mite, pyre moth).
    if (spr.set.maps.length > 1) {
      const period = data.type === 'mite' ? 95 : data.type === 'bat' ? 135 : 270;
      const idx = Math.floor(t / period + off) % 2;
      if (mat.map !== spr.set.maps[idx]) mat.map = spr.set.maps[idx];
    }

    // Color: compose elite wash, boss roulette wash, buff tint,
    // per-type charge telegraphs, then the hit flash whitening.
    let r = 1, g = 1, b = 1;
    if ((data as any).elite) { r *= 1.06; g *= 1.02; b *= 0.9; }
    if (data.wash) {
      r += (data.wash[0] * 1.15 - r) * 0.65;
      g += (data.wash[1] * 1.15 - g) * 0.65;
      b += (data.wash[2] * 1.15 - b) * 0.65;
    }
    if (data.buffed) { r *= 1.35; g *= 0.55; b *= 0.75; }
    if (data.type === 'golem') { const w = 1 + 0.45 * charge; r *= w; g *= 1 + 0.2 * charge; }
    else if (data.type === 'imp') {
      const w = charge * 0.55; r *= 1 + w; g *= 1 + w * 0.85; b *= 1 + w * 0.6;
      if (data.state === 'tired') { r *= 0.72; g *= 0.72; b *= 0.72; }
    } else if (data.type === 'sentry_shard') { g *= 1 + 0.3 * charge; b *= 1 + 0.45 * charge; }
    else if (data.type === 'wraith') {
      if (data.state === 'lock') { const f = 0.5 + 0.5 * Math.sin(t * 0.02); const w = 1 + 0.55 * f * Math.max(0.25, charge); r *= w; g *= w; b *= w; }
    } else if (data.type === 'darter') { const w = 1 + 0.4 * charge; r *= w; g *= w; b *= 1 + 0.25 * charge; }
    else if (data.type === 'pyre_moth') {
      if (data.state === 'fusing' || charge > 0.6) { const s = Math.sin(t * 0.03 + off) > 0 ? 1.4 : 0.75; r *= s; g *= s; b *= s; }
    } else if (data.type === 'rift_mine') {
      const rate = charge > 0.4 ? 0.03 : 0.008;
      const s = 0.78 + 0.4 * (0.5 + 0.5 * Math.sin(t * rate + off));
      r *= s; g *= s; b *= s;
    } else if (data.type === 'shieldback') {
      if (data.sparkUntil && t < data.sparkUntil) { r *= 1.5; g *= 1.45; b *= 1.3; }
    }
    if (flashEnv > 0) { const f = 1 + flashEnv * 1.15; r *= f; g *= f; b *= f; }
    mat.color.setRGB(r, g, b);

    // Opacity: spawn fade, then the phase reads. Bolts skip the
    // fade: they live about a second and must read instantly.
    let op = 0.9;
    if (data.type === 'projectile_player' || PICKUP_SPRITE_TYPES.has(data.type)) {
      op = 0.95;
    } else if (entity.bornMs !== undefined) {
      const age = (nowMs - entity.bornMs) / 300;
      op *= Math.min(1, Math.max(0, age));
    }
    if (data.type === 'phantom') {
      if (data.state === 'phased') op = 0.25;
      else if (data.state === 'reappear') op = 0.25 + 0.65 * charge;
    }
    if (data.type === 'boss_shadow') op *= 0.85;
    mat.opacity = op;
  }

flashEnvelope(entity: ParticleEntity, nowMs: number): number {
    if (!entity.flashStartMs) return 0;
    const p = (nowMs - entity.flashStartMs) / (entity.flashDurationMs || 60);
    return p >= 1 ? 0 : 1 - p;
  }

  // Death bursts (Section 3.1): points scatter outward from the shape
  // they died in and cool toward dark ember over 0.4 s, then dispose.
updateDyingBursts(nowMs: number) {
    for (let i = this.host.dyingBursts.length - 1; i >= 0; i--) {
      const burst = this.host.dyingBursts[i];
      const p = (nowMs - burst.startMs) / 400;
      if (p >= 1) {
        this.host.scene.remove(burst.mesh);
        burst.mesh.geometry.dispose();
        (burst.mesh.material as THREE.Material).dispose();
        this.host.dyingBursts.splice(i, 1);
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
createEntityMesh(data: PhysicsEntity): ParticleEntity {
    const world = WORLDS[this.host.gameState.selectedWorldIndex()];
    const hostile = world?.themeData?.palette?.hostile ?? HOSTILE_RGB;
    const buildCtx = {
      r: data.size / 30, // Scale factor, as shipped
      hostile,
      ownerId: data.ownerId,
      owner: (data as any).owner,
      gameMode: this.host.gameState.currentGameMode(),
      worldIndex: this.host.gameState.selectedWorldIndex(),
      shieldColor: bossDefFor(this.host.gameState.selectedWorldIndex()).shieldColor,
      bird: this.host.bird ? { basePositions: this.host.bird.basePositions, colorAt: (i: number) => this.host.birdColorAt(this.host.bird, i) } : null,
    };
    const built = buildEntityGeometry(data.type, buildCtx);
    // World 10 elite tint (S6): Rift elites wash toward white-gold
    // at build time, so a tinted Sturdy or Armored body reads at a
    // glance next to its untinted kin.
    if ((data as any).elite) {
      const cols = built.colors;
      for (let i = 0; i < cols.length; i += 3) {
        cols[i] = cols[i] * 0.62 + 1.0 * 0.38;
        cols[i + 1] = cols[i + 1] * 0.62 + 0.97 * 0.38;
        cols[i + 2] = cols[i + 2] * 0.62 + 0.88 * 0.38;
      }
    }
    // Chaos Demon forms (Stage 10): build the other two forms now
    // so the render loop can flow between them without rebuilding.
    let formGeos: ParticleEntity['formGeos'];
    if (data.type === 'boss' && buildCtx.worldIndex === 8) {
      formGeos = [0, 1, 2].map(f => {
        const g = buildEntityGeometry('boss', { ...buildCtx, form: f });
        return { positions: g.positions, colors: g.colors };
      });
    }

    // The foe luminance clamp runs last (after the World 10 elite
    // wash, which pushes toward white-gold) so the cap is the final
    // word on every enemy build, forms included. baseColors below
    // copies the clamped array, so the per-frame writers inherit it.
    if (!FOE_CLAMP_EXEMPT.has(data.type)) {
      clampFoeLuminance(built.colors);
      if (formGeos) for (const g of formGeos) clampFoeLuminance(g.colors);
    }

    // Drawn mob sprites (Fix Round 2, A5): enemies, bosses, and
    // the Shadow Lord's copies render as painted bodies, never
    // point clouds. The points geometry is still built above (the
    // codex shares it, and its extents size the sprite plane, so
    // the mob keeps exactly its shipped footprint). Effects,
    // projectiles, pickups, and zones keep the points path below.
    if (MOB_SPRITE_TYPES.has(data.type) || data.type === 'projectile_player' || PICKUP_SPRITE_TYPES.has(data.type)) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const bp = built.positions;
      for (let i = 0; i < bp.length; i += 3) {
        if (bp[i] < minX) minX = bp[i];
        if (bp[i] > maxX) maxX = bp[i];
        if (bp[i + 1] < minY) minY = bp[i + 1];
        if (bp[i + 1] > maxY) maxY = bp[i + 1];
      }
      const extentX = Math.max(0.15, (maxX - minX) / 2);
      const extentY = Math.max(0.15, (maxY - minY) / 2);
      // A6: the player's basic shots are elongated flame bolts
      // (the watched bird in ai_vs_ai fires the violet family, the
      // same ownership colors the points build used).
      const isBolt = data.type === 'projectile_player';
      const sets = data.type === 'boss'
        ? getBossFormSets(buildCtx.worldIndex, extentX, extentY)
        : isBolt
          ? [getBoltSpriteSet(data.ownerId === 'player' && buildCtx.gameMode === 'ai_vs_ai' ? 'violet' : 'amber')]
          : PICKUP_SPRITE_TYPES.has(data.type)
            ? [getPickupSpriteSet(data.type)]
            : [getMobSpriteSet(data.type, buildCtx.worldIndex, extentX, extentY)];
      const set = sets[0];
      const mat = new THREE.MeshBasicMaterial({ map: set.maps[0], transparent: true, opacity: 0.9, depthWrite: false });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      plane.frustumCulled = false;
      const baseScaleX = extentX * 2 * (isBolt ? 1.3 : 1.06);
      const baseScaleY = extentY * 2 * (isBolt ? 2.4 : 1.06);
      plane.scale.set(baseScaleX, baseScaleY, 1);
      return {
        mesh: plane,
        type: data.type,
        sprite: {
          sets, set, baseScaleX, baseScaleY,
          heading: -Math.PI / 2, prevX: 0, prevY: 0,
        },
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

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(built.colors, 3));

    // Per-type sprite size (final sweep; the route STAGE-2.md
    // recorded for the Gloomwing): every type renders at the
    // shipped 0.15 except the bat, whose 0.08 sprites cut its
    // additive stacking depth along the wing band from 30 to 60
    // deep to roughly 9 to 17 deep. At that depth the wing's red
    // base (0.045 maximum) tops out around 0.77 and never pins, so
    // the design sheet's purple wing gradient survives rendering
    // instead of walking to the hostile magenta (see the bat
    // sampler in entity-builder.ts). Recorded change: bat sprite
    // size 0.15 -> 0.08; the builder wing bases rose with it.
    const spriteSize = data.type === 'bat' ? 0.08 : 0.15;
    const material = new THREE.PointsMaterial({ size: spriteSize, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
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
      formGeos,
    };
  }
}
