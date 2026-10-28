// Bird movement simulation for the particle phoenix: steering,
// banking, stamina movement verbs (Systems S1), trail emission, and
// the cosmetic meshes that follow the bird. Runs on the state the
// component owns, reached through the host interface. Moved out of
// particle-bg.component.ts in the code organization pass (Oct 27,
// 2026); logic unchanged.
import * as THREE from 'three';
import { GameStateService, STAMINA } from '../../services/game-state.service';
import { PhoenixState } from './phoenix-state';
import { HOSTILE_SKIN, phoenixSkinById } from './phoenix-skins';

// The shipped speed stat is anchored at 2.0 (BASE_STATS.speed): before
// the Oct 25, 2026 speed retune the stat fed the cruise multiplier raw,
// so base stats cruised at (visibleWidth / 1.4) x 2.0, a nominal 0.70 s
// crossing. The retune normalizes every stat-derived multiplier by
// this base, so base stats yield exactly the canonical crossing and
// each upgrade step keeps its relative size (a step that raised pace
// by X percent before still raises it by X percent).
export const BASE_SPEED_STAT = 2.0;

// Trail tuning (spec Section 2.3): the visible tail spans about this
// many seconds of flight history, constant at any refresh rate,
// because history sampling below is computed in seconds, not frames.
export const TRAIL_SECONDS = 0.45;

export interface BirdPhysicsHost {
  readonly MAX_HISTORY: number;
  birdScale: number;
  boundX: number;
  boundY: number;
  camera: THREE.PerspectiveCamera;
  celestialShieldMesh: THREE.Points;
  cosmicTrailMesh: THREE.Points;
  goldenAuraMesh: THREE.Points;
  gameState: GameStateService;
  trailAccumulator: number;
  visState: 'alive' | 'dying' | 'dead' | 'rebirth';
  wasGameScreen: boolean;
}

export class BirdPhysics {
  constructor(private host: BirdPhysicsHost) {}

updateBirdPhysics(bird: PhoenixState, targetWaypoint: THREE.Vector3, baseSpeed: number, dt: number, frameScale: number, isAi: boolean) {
      if (!this.host.gameState.isPaused() && !this.host.gameState.isDeadMenuOpen()) {
          
          if (!this.host.wasGameScreen && this.host.gameState.activeScreen() === 'game') {
              bird.position.copy(targetWaypoint);
              bird.targetWaypoint.copy(targetWaypoint);
          }
          
          // Player bird follows the mouse on the game screen AND on the menu (so it's controllable
          // the moment the app loads). The AI bird only animates in-game.
          const isMenuScreen = this.host.gameState.activeScreen() === 'menu';
          if (this.host.gameState.activeScreen() === 'game' || (!isAi && isMenuScreen)) {
          const overridePos = isAi ? this.host.gameState.aiPhoenixOverridePosition() : this.host.gameState.phoenixOverridePosition();
          if (overridePos) {
              const vec = new THREE.Vector3(
                  (overridePos.x / window.innerWidth) * 2 - 1,
                  -(overridePos.y / window.innerHeight) * 2 + 1,
                  0.5
              );
              vec.unproject(this.host.camera);
              vec.sub(this.host.camera.position).normalize();
              const dist = (-15 - this.host.camera.position.z) / vec.z;
              targetWaypoint = this.host.camera.position.clone().add(vec.multiplyScalar(dist));
          }

          // Final sweep: a Phoenix Singularity pull bends this
          // bird's steering target toward the vortex while the bird
          // is inside the pull radius (the executor publishes the
          // active pull in screen space; an enemy cast targets the
          // player bird, a player cast the rival bird). The pull
          // only ever rewrites the target: every steering safety
          // below (turn caps, spool, bounds) still applies, and a
          // bird steered hard away can still escape, which is the
          // move's documented risk made real for birds too.
          const singularityPull = isAi ? this.host.gameState.playerSingularityPull() : this.host.gameState.enemySingularityPull();
          if (singularityPull && Date.now() < singularityPull.until && this.host.gameState.activeScreen() === 'game') {
              const toWorld = (sx: number, sy: number) => {
                  const v = new THREE.Vector3((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1, 0.5);
                  v.unproject(this.host.camera);
                  v.sub(this.host.camera.position).normalize();
                  const d = (-15 - this.host.camera.position.z) / v.z;
                  return this.host.camera.position.clone().add(v.multiplyScalar(d));
              };
              const centerW = toWorld(singularityPull.x, singularityPull.y);
              const radiusW = centerW.distanceTo(toWorld(singularityPull.x + singularityPull.radius, singularityPull.y));
              if (bird.position.distanceTo(centerW) <= radiusW) {
                  targetWaypoint = targetWaypoint.clone().lerp(centerW, 0.45);
              }
          }

          const isRebirthingNow = this.host.gameState.isRebirthing() && !isAi;

          const mat = bird.particles.material as THREE.PointsMaterial;
          if (isRebirthingNow) {
              mat.color.setRGB(0.2, 0.2, 0.2); // Ash color
              bird.velocity.set(0, 0, 0);
          } else {
              if (!isAi) {
                  if (this.host.gameState.isDrilling()) {
                      mat.color.setRGB(1.5, 0.3, 0.3); // Intense red glow
                  } else {
                      mat.color.setRGB(1, 1, 1); // Normal color
                  }
                  if (Date.now() < this.host.gameState.immortalUntil) {
                      mat.opacity = Math.floor(Date.now() / 250) % 2 === 0 ? 0.15 : 1.0;
                  } else {
                      mat.opacity = 1.0;
                  }
                  // Dash entry: a short white-hot core flash (spec 2.2).
                  const drillingNow = this.host.gameState.isDrilling();
                  if (drillingNow && !bird.wasDrilling) bird.flashUntil = performance.now() + 120;
                  bird.wasDrilling = drillingNow;
                  // Meteor Rush entry (S2): the same white-hot flash
                  // marks the rush window opening.
                  const rushingNow = this.host.gameState.isMeteorRushing();
                  if (rushingNow && !bird.wasRushing) bird.flashUntil = performance.now() + 120;
                  bird.wasRushing = rushingNow;
              }

              // Flap rate (spec 2.2): menu cruise is calmer (0.6x), a
              // sustained climb over 0.4 s becomes a flap burst (1.6x),
              // and the rebirth reform window bursts as well. Cruise in
              // level flight stays at the historical rate.
              if (!isAi) {
                  if (this.host.gameState.activeScreen() === 'game' && bird.velocity.y > 0.3 * Math.max(1, bird.velocity.length())) {
                      bird.climbTime += dt;
                  } else {
                      bird.climbTime = Math.max(0, bird.climbTime - dt * 2);
                  }
                  bird.flapRate = this.host.gameState.activeScreen() === 'menu' ? 0.6
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
                  if (this.host.gameState.activeScreen() === 'menu') {
                      speedMult = 1.0; // Menu: plain mouse-follow regardless of saved mode
                  } else if (this.host.gameState.currentGameMode() === 'ai_vs_ai') {
                      speedMult = this.host.gameState.ai2PhoenixSpeed() / BASE_SPEED_STAT;
                  } else {
                      speedMult = this.host.gameState.currentStats().speed / BASE_SPEED_STAT;
                      if (Date.now() < this.host.gameState.speedBoostUntil) speedMult *= 2.0;
                      if (this.host.gameState.isDrilling()) {
                          const modifiers = this.host.gameState.currentStats().unlockedAbilities['drill_attack']?.modifiers;
                          if (modifiers && modifiers['speed']) speedMult *= modifiers['speed'];
                      }
                  }
              } else {
                  speedMult = this.host.gameState.aiPhoenixSpeed() / BASE_SPEED_STAT;
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
                  const mv0 = isAi ? this.host.gameState.aiMovement
                      : (this.host.gameState.activeScreen() === 'game' && this.host.gameState.currentGameMode() === 'ai_vs_ai')
                          ? this.host.gameState.ai2Movement : this.host.gameState.playerMovement;
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
              const onGameScreen = this.host.gameState.activeScreen() === 'game';
              const move = isAi ? this.host.gameState.aiMovement
                  : (onGameScreen && this.host.gameState.currentGameMode() === 'ai_vs_ai')
                      ? this.host.gameState.ai2Movement : this.host.gameState.playerMovement;
              const moveNow = Date.now();
              const brakingNow = onGameScreen && move.braking;
              this.host.gameState.tickMovement(move, dt);

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
                      if (rate > 0.436) this.host.gameState.endGlide(move);
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
                  if (this.host.gameState.spendStamina(move, STAMINA.rollCost)) {
                      const candA = { x: -currentDir.y, y: currentDir.x };
                      const useX = Math.abs(candA.x) >= Math.abs(candA.y);
                      const bound = useX ? this.host.boundX : this.host.boundY;
                      const posAlong = useX ? bird.position.x : bird.position.y;
                      const compA = useX ? candA.x : candA.y;
                      const roomA = compA >= 0 ? bound - posAlong : posAlong + bound;
                      const roomB = (useX ? this.host.boundX * 2 : this.host.boundY * 2) - roomA;
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
              const deadZoneWorld = 6 * (minDimPx / 412) * ((this.host.boundX * 2) / Math.max(1, window.innerWidth));
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
        screenPos.project(this.host.camera);
        const x2d = (screenPos.x * .5 + .5) * window.innerWidth;
        const y2d = (screenPos.y * -.5 + .5) * window.innerHeight;
        
        if (isAi) {
            this.host.gameState.aiPhoenixScreenPos.set({x: x2d, y: y2d});
        } else {
            this.host.gameState.phoenixScreenPos.set({x: x2d, y: y2d});
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

        if (!isAi && this.host.gameState.isDrilling()) {
            bird.currentBank += 0.5 * frameScale;
        } else {
            bird.currentBank += (targetBank - bird.currentBank) * (1 - Math.pow(1 - 0.025, frameScale));
        }

        // Air Roll visual (spec Section 2.3): one full barrel rotation
        // across the hop, layered over the bank, turning toward the
        // hop direction. The trail corkscrews on its own because the
        // hop really moves the bird sideways through its history.
        const rollMove = isAi ? this.host.gameState.aiMovement
            : (this.host.gameState.activeScreen() === 'game' && this.host.gameState.currentGameMode() === 'ai_vs_ai')
                ? this.host.gameState.ai2Movement : this.host.gameState.playerMovement;
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
        if (bird.historyPos.length > this.host.MAX_HISTORY) {
            bird.historyPos.pop(); bird.historyQuat.pop();
        }

        // Formation sampling is ARC-LENGTH based (Fix Round 1,
        // Part 1). The old code sampled history by time divided by
        // the current speed (trailT = scaledBaseZ / speedNow, index
        // trailT / dt): whenever the speed collapsed (hover arrival,
        // Feather Brake, dash end, reversal spool) trailT exploded
        // past the designed 0.45 s trail window and body and tail
        // points pinned to positions seconds old, so the formation
        // smeared along the flight path and sat apart from the glyph
        // sprite, reading as a second bird, and particles appeared
        // to fly off and glitch on device. Sampling by distance
        // travelled instead keeps every point at a fixed arc offset
        // behind the head: when the bird is parked the recorded path
        // has near-zero length, so all points gather at the bird.
        //
        // Teleport flush: if the newest history step is a
        // discontinuity (run start copies the bird to its entry
        // waypoint, menu and game positions differ), refill the
        // history with the current pose so no streak is drawn from
        // the old position. Legit per-substep travel tops out near
        // 2.8 world units (dash plus boost at the widest cruise);
        // the 4.0 threshold sits safely above that.
        if (bird.historyPos.length > 1) {
            const jump = bird.historyPos[0].distanceTo(bird.historyPos[1]);
            if (jump > 4.0) {
                for (let h = 1; h < bird.historyPos.length; h++) {
                    bird.historyPos[h].copy(bird.historyPos[0]);
                    bird.historyQuat[h].copy(bird.historyQuat[0]);
                }
            }
        }
        const histCum = new Float32Array(bird.historyPos.length);
        for (let h = 1; h < bird.historyPos.length; h++) {
            histCum[h] = histCum[h - 1] + bird.historyPos[h].distanceTo(bird.historyPos[h - 1]);
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
            const coreSpan = 8 * this.host.birdScale * 0.85;
            bird.core.scale.set(coreSpan, coreSpan, coreSpan);
            const coreLen = coreSpan * 1.25;
            const anchorBack = new THREE.Vector3(0, 0, -0.44 * coreLen).applyQuaternion(bird.core.quaternion);
            bird.core.position.add(anchorBack);
            bird.core.visible = bird.group.visible && !(!isAi && this.host.gameState.isRebirthing());
            if (!isAi && this.host.visState === 'alive') {
                (bird.core.material as THREE.MeshBasicMaterial).opacity = 0.9 * (bird.particles.material as THREE.PointsMaterial).opacity;
            }
        }

        // Keep the visibility glow centred on the bird, sized to the
        // wingspan (per-skin span, spec 2.4), blinking in step with the
        // particles during i-frames.
        if (bird.glow) {
            bird.glow.position.copy(bird.position);
            const glowSpan = 8 * this.host.birdScale * bird.glowSpanFactor;
            bird.glow.scale.set(glowSpan, glowSpan, 1);
            bird.glow.visible = bird.group.visible && !(!isAi && this.host.gameState.isRebirthing());
            if (!isAi) {
                const gm = bird.glow.material as THREE.SpriteMaterial;
                let glowOpacity = 0.5 * (bird.particles.material as THREE.PointsMaterial).opacity;
                if (this.host.gameState.activeScreen() === 'menu') glowOpacity *= 0.8; // calmer menu glow (spec 2.2)
                if (bird.climbTime > 0.4 && this.host.gameState.activeScreen() === 'game') glowOpacity *= 1.2; // flap burst glow (spec 2.2)
                gm.opacity = glowOpacity;
            }
        }

        if (!this.host.gameState.isPaused() && (!this.host.gameState.isRebirthing() || isAi)) {
            bird.flapTime += 0.04 * frameScale * bird.flapRate;
        }
        const mainPos = bird.particles.geometry.attributes['position'].array as Float32Array;
        const fillPos = bird.fillParticles ? (bird.fillParticles.geometry.attributes['position'].array as Float32Array) : mainPos;

        if (!isAi && this.host.gameState.isRebirthing()) {
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
            const drillingNow = !isAi && this.host.gameState.isDrilling();
            const speedNow = Math.max(0.001, bird.velocity.length());
            // Body and tail extents in base-position units (the tail
            // sampler tops out at 10, the body sphere at 3.6).
            const zBody = 3.6, zMax = 10;
            const bodySpanWorld = zBody * this.host.birdScale;
            const tailSpanWorld = (zMax - zBody) * this.host.birdScale;
            for (let k = 0; k < bird.phoenixCount; k++) {
              const idx = k * 3;
              const baseX = bird.basePositions[idx];
              const baseY = bird.basePositions[idx + 1];
              const baseZ = bird.basePositions[idx + 2];

              const scaledBaseX = baseX * this.host.birdScale;
              const scaledBaseY = baseY * this.host.birdScale;
              const scaledBaseZ = baseZ * this.host.birdScale;

              // Arc-length history sampling (spec 2.3 as amended by
              // Fix Round 1, Part 1): body points sit at their base
              // distance behind the head along the recorded path;
              // tail points remap onto a trail whose length is
              // speedNow * TRAIL_SECONDS of travel, so at cruise the
              // visible trail still spans 0.45 s of flight, while at
              // low speed the trail compresses onto the bird instead
              // of reaching seconds back in time. The drill dash
              // compresses the ribbon spacing to 0.7 so the bird
              // reads as a tightening corkscrew (spec 2.2).
              let distBack: number;
              if (scaledBaseZ <= bodySpanWorld) {
                  distBack = scaledBaseZ;
              } else {
                  const trailLen = Math.max(bodySpanWorld, speedNow * TRAIL_SECONDS);
                  distBack = bodySpanWorld + ((scaledBaseZ - bodySpanWorld) / tailSpanWorld) * (trailLen - bodySpanWorld);
              }
              if (drillingNow) distBack *= 0.7;
              let lo = 0, hi = histCum.length - 1;
              while (lo < hi) {
                  const mid = (lo + hi + 1) >> 1;
                  if (histCum[mid] <= distBack) lo = mid; else hi = mid - 1;
              }

              const hPos = bird.historyPos[lo];
              const hQuat = bird.historyQuat[lo];

              let flapAmount = Math.abs(scaledBaseX) * 0.5;
              // Bank compression (spec 2.2): the inside wing's flap
              // amplitude halves at full bank, so turns read as a
              // bird, not a rotating sticker.
              if (Math.abs(bird.currentBank) > 0.05 && Math.abs(scaledBaseX) > 0.5 * this.host.birdScale) {
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
              const flickerX = (Math.random() - 0.5) * flick * this.host.birdScale;
              const flickerY = (Math.random() - 0.5) * flick * this.host.birdScale;

              const localOffset = new THREE.Vector3(scaledBaseX + flickerX, scaledBaseY + flapOffset + flickerY, 0);
              // Skin trail character (spec 2.4): Frost sheds slow
              // sparks that fall instead of streaming; Verdant sheds
              // drifting pollen motes; Celestial fill sparkles twinkle.
              if (scaledBaseZ > bodySpanWorld) {
                  if (skin.trailStyle === 'snow') {
                      localOffset.y -= (scaledBaseZ / (zMax * this.host.birdScale)) * 0.35 * this.host.birdScale;
                  } else if (skin.trailStyle === 'pollen') {
                      localOffset.x += Math.sin(bird.flapTime * 0.7 + scaledBaseZ * 1.5) * 0.10 * this.host.birdScale;
                  }
              }
              if (bird.sparkle[k] && skin.trailStyle === 'sequence') {
                  localOffset.x += Math.sin(Date.now() * 0.005 + k * 1.7) * 0.08 * this.host.birdScale;
                  localOffset.y += Math.cos(Date.now() * 0.004 + k * 2.3) * 0.08 * this.host.birdScale;
              }
              localOffset.applyQuaternion(hQuat);

              let finalX = hPos.x + localOffset.x;
              const wrapWidth = this.host.boundX * 2 + 10;

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
            if (this.host.goldenAuraMesh) {
                this.host.goldenAuraMesh.visible = this.host.gameState.hasGoldenAura() && this.host.gameState.toggleGoldenAura() && !this.host.gameState.isRebirthing();
                if (this.host.goldenAuraMesh.visible) {
                    this.host.goldenAuraMesh.position.copy(bird.position);
                    this.host.goldenAuraMesh.quaternion.copy(dummy.quaternion);
                    const auraPos = this.host.goldenAuraMesh.geometry.attributes['position'].array as Float32Array;
                    const auraBase = this.host.goldenAuraMesh.geometry.attributes['basePosition'].array as Float32Array;
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
                    this.host.goldenAuraMesh.geometry.attributes['position'].needsUpdate = true;
                }
            }

            if (this.host.celestialShieldMesh) {
                this.host.celestialShieldMesh.visible = this.host.gameState.hasCelestialShield() && this.host.gameState.toggleCelestialShield() && !this.host.gameState.isRebirthing();
                if (this.host.celestialShieldMesh.visible) {
                    const targetPos = (this.host.celestialShieldMesh as any).targetPos;
                    targetPos.lerp(bird.position, 1 - Math.pow(0.9, frameScale));
                    this.host.celestialShieldMesh.position.copy(targetPos);
                    this.host.celestialShieldMesh.rotation.y += 0.01 * frameScale;
                    this.host.celestialShieldMesh.rotation.x += 0.005 * frameScale;
                    const shieldPos = this.host.celestialShieldMesh.geometry.attributes['position'].array as Float32Array;
                    const shieldBase = this.host.celestialShieldMesh.geometry.attributes['basePosition'].array as Float32Array;
                    const pulse = 1 + Math.sin(Date.now() * 0.003) * 0.05;
                    for (let i = 0; i < shieldPos.length; i++) {
                        shieldPos[i] = shieldBase[i] * pulse;
                    }
                    this.host.celestialShieldMesh.geometry.attributes['position'].needsUpdate = true;
                }
            }

            if (this.host.cosmicTrailMesh) {
                this.host.cosmicTrailMesh.visible = this.host.gameState.hasCosmicTrail() && this.host.gameState.toggleCosmicTrail() && !this.host.gameState.isRebirthing();
                if (this.host.cosmicTrailMesh.visible) {
                    // Shift the trail at a fixed 60 Hz cadence so its
                    // length in seconds does not shrink at 120 Hz.
                    this.host.trailAccumulator += dt;
                    if (this.host.trailAccumulator >= 1 / 60) {
                        this.host.trailAccumulator = 0;
                        const tPos = this.host.cosmicTrailMesh.geometry.attributes['position'].array as Float32Array;
                        for (let i = tPos.length - 1; i >= 3; i--) {
                            tPos[i] = tPos[i - 3];
                        }
                        const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(dummy.quaternion).multiplyScalar(2);
                        tPos[0] = bird.position.x + backward.x + (Math.random() - 0.5) * 1.5;
                        tPos[1] = bird.position.y + backward.y + (Math.random() - 0.5) * 1.5;
                        tPos[2] = bird.position.z + backward.z + (Math.random() - 0.5) * 1.5;
                        this.host.cosmicTrailMesh.geometry.attributes['position'].needsUpdate = true;
                    }
                }
            }
        }
      }
  }
}
