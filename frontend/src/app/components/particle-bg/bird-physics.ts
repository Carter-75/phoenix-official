// Bird flight and rendering for the drawn phoenix (Bird Rebuild
// Round, Oct 28, 2026): arrive-and-park steering, banking, stamina
// movement verbs (Systems S1), and the sprite rig placement (main
// plane, ash plane, ghost ribbon, glow). Runs on the state the
// component owns, reached through the host interface.
//
// History: this file held the particle formation writer until the
// rebuild. Carter's phone showed that formation as a pixelated flame
// blob with no bird shape (its wing axis mapped to world depth, so
// the silhouette collapsed at gameplay headings), and its capped-turn
// steering orbited a still target forever because the turn radius at
// cruise (about 1.84 world units) dwarfed the hover capture radius
// (about 0.52). Both are replaced here: the bird is a drawn sprite
// (phoenix-sprite.ts), and steering is a spring-damper arrive that
// decelerates into the target and parks.
import * as THREE from 'three';
import { GameStateService, STAMINA } from '../../services/game-state.service';
import { PhoenixState } from './phoenix-state';
import { HOSTILE_SKIN, phoenixSkinById } from './phoenix-skins';
import { TURNING, INPUT_RULES } from '../../data/balance.constants';
import { trackGlide } from '../../input/gesture-core';
import { PHOENIX_ANCHOR_NZ, ensureAshFrames, flapFrameIndex, getPhoenixFrames } from './phoenix-sprite';

// The shipped speed stat is anchored at 2.0 (BASE_STATS.speed): before
// the Oct 25, 2026 speed retune the stat fed the cruise multiplier raw,
// so base stats cruised at (visibleWidth / 1.4) x 2.0, a nominal 0.70 s
// crossing. The retune normalizes every stat-derived multiplier by
// this base, so base stats yield exactly the canonical crossing and
// each upgrade step keeps its relative size (a step that raised pace
// by X percent before still raises it by X percent).
export const BASE_SPEED_STAT = 2.0;

// Trail tuning (spec Section 2.3): the ghost ribbon spans about this
// many seconds of flight at cruise, constant at any refresh rate,
// because the ghost placement below is computed from arc length.
export const TRAIL_SECONDS = 0.45;

// Arrive profile: inside this many seconds of travel from the
// target, the desired speed ramps linearly down with distance, so
// the bird eases in instead of overshooting. The acceleration cap
// is a multiple of cruise speed per second. Retuned after the
// first sandbox proofs (Bird Rebuild): at 0.38 s the exponential
// settle tail made park-to-park crossings read about 2.0 to 2.18 s
// against the old model's 1.42 to 1.49 s baseline, which felt
// sluggish even though the sustained cruise between gates stayed
// exactly on the visibleWidth / 1.4 law (balance-cross reads 1.42
// to 1.45 s at all four sizes either way). At 0.20 s the arrival
// reads land near the old baseline and the park-settle branch
// below still ends arrivals dead still.
const ARRIVE_SECONDS = 0.20;
const ACCEL_PER_CRUISE = 14;

export interface BirdPhysicsHost {
  readonly MAX_HISTORY: number;
  birdScale: number;
  boundX: number;
  boundY: number;
  // World scroll walls (World 1 Finish): how far inside boundX
  // the bird's flight clamps when the selected world has side
  // walls, in flight-plane world units. 0 = no walls, no clamp.
  // boundX itself never changes; the wall face sits at
  // boundX - wallInsetX and the bird parks at that line.
  wallInsetX: number;
  camera: THREE.PerspectiveCamera;
  celestialShieldMesh: THREE.Points;
  cosmicTrailMesh: THREE.Points;
  goldenAuraMesh: THREE.Points;
  gameState: GameStateService;
  trailAccumulator: number;
  visState: 'alive' | 'dying' | 'dead' | 'rebirth';
  visScaleMul: number;
  wasGameScreen: boolean;
}

export class BirdPhysics {
  constructor(private host: BirdPhysicsHost) {}

updateBirdPhysics(bird: PhoenixState, targetWaypoint: THREE.Vector3, baseSpeed: number, dt: number, frameScale: number, isAi: boolean) {
      // Flight lore death flow (Oct 28, 2026): while the player bird
      // is in the 'falling' down phase, the world is frozen and only
      // the bird animates. It loses lift: lateral velocity bleeds
      // away, gravity pulls it down-screen with a terminal speed, its
      // wings slow to a weak flutter, and the ash mix ramps in (the
      // wounded look). Steering, stamina verbs, and the movement kit
      // are all skipped; the shared tail below (screen position,
      // heading, history, sprite render) still runs, so the fall is
      // drawn and phoenixScreenPos tracks it for the game component,
      // which opens the KO panel only once the bird has fully left
      // the screen.
      const falling = !isAi && this.host.gameState.playerDownPhase() === 'falling';
      if (falling) {
          const terminal = baseSpeed * 2.1;
          bird.velocity.x *= Math.exp(-2.4 * dt);
          bird.velocity.y -= baseSpeed * 3.4 * dt;
          if (bird.velocity.y < -terminal) bird.velocity.y = -terminal;
          bird.velocity.z = 0;
          bird.position.add(bird.velocity.clone().multiplyScalar(dt));
          bird.position.z = -15;
          bird.hovering = false;
          bird.flapRate = 0.3;
          bird.renderAshMix = Math.min(0.85, bird.renderAshMix + dt * 1.3);
          bird.renderTint.setRGB(1, 1, 1);
          bird.renderOpacity = 1.0;
      }

      // The tail of this method (screen position, heading, flap,
      // sprite render) sits inside this gate, so the gate must stay
      // open during the down state's fall: steering alone is
      // suppressed while falling (the fall branch above owns the
      // motion then), while pause and the death menu keep the
      // shipped full freeze of the whole method.
      if (!this.host.gameState.isPaused() && !this.host.gameState.isDeadMenuOpen()) {
      if (!falling) {

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
          // only ever rewrites the target: the arrival steering
          // below still applies, and a bird steered hard away can
          // still escape, which is the move's documented risk made
          // real for birds too.
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

          // Base material state for this substep (the component's
          // visual-state machine composes flash, death, and rebirth
          // over these after the substeps): drill tint, i-frame
          // blink, ash mix for the Rebirth ability's ash state.
          bird.renderAshMix = isRebirthingNow ? 1 : 0;
          if (!isAi) {
              if (this.host.gameState.isDrilling()) {
                  bird.renderTint.setRGB(1.5, 0.3, 0.3); // Intense red glow
              } else {
                  bird.renderTint.setRGB(1, 1, 1); // Normal color
              }
              if (Date.now() < this.host.gameState.immortalUntil) {
                  bird.renderOpacity = Math.floor(Date.now() / 250) % 2 === 0 ? 0.15 : 1.0;
              } else {
                  bird.renderOpacity = 1.0;
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
          } else {
              bird.renderTint.setRGB(1, 1, 1);
              bird.renderOpacity = 1.0;
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

          if (isRebirthingNow) {
              // Ash state: the bird hangs motionless while the
              // rebirth charge runs (existing behavior). Position,
              // heading, and history hold; the render write below
              // shows the ash sprite with a jitter.
              bird.velocity.set(0, 0, 0);
              bird.hovering = true;
          } else {
              // Frame-rate independent waypoint smoothing: the old fixed
              // 0.1 lerp per frame converged twice as fast at 120 Hz.
              bird.targetWaypoint.lerp(targetWaypoint, 1 - Math.pow(0.9, frameScale));
              // Side walls: the steering target never enters the
              // wall zone, so arrivals park at the wall face.
              if (this.host.wallInsetX > 0) {
                  const maxX = this.host.boundX - this.host.wallInsetX;
                  bird.targetWaypoint.x = Math.max(-maxX, Math.min(maxX, bird.targetWaypoint.x));
              }

              const toTarget = bird.targetWaypoint.clone().sub(bird.position);
              toTarget.z = 0;
              const distToTarget = toTarget.length();

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
              // Published for the turning controller's speed
              // weighting (Fix Round 4): aim versus velocity is
              // blended as a fraction of this live cruise speed.
              bird.cruiseSpeedNow = cruiseSpeed;

              const speedNow = bird.velocity.length();
              const currentDir = speedNow > 1e-4
                  ? bird.velocity.clone().divideScalar(speedNow)
                  : new THREE.Vector3(Math.cos(bird.headingAngle), Math.sin(bird.headingAngle), 0);
              currentDir.z = 0;
              const desiredDir = distToTarget > 1e-6
                  ? toTarget.clone().divideScalar(distToTarget) : currentDir.clone();
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
              trackGlide(move, headingNow, dt);

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

              // Reversal spool (Section 2.1): after a direction
              // reversal over 90 degrees, speed spools back toward
              // cruise with about a 120 ms time constant, so
              // reversals carve a small arc instead of pivoting.
              // The spool only bites inside reversals; straight
              // flight and the 1.4 s crossing anchor are untouched.
              let speedFactor = brakingNow ? INPUT_RULES.brakeSpeedFactor : 1.0;
              if (currentDir.dot(desiredDir) < 0 && bird.spoolT < 0) bird.spoolT = 0;
              if (bird.spoolT >= 0) {
                  bird.spoolT += dt;
                  const spoolFactor = 1 - 0.65 * Math.exp(-bird.spoolT / 0.12);
                  speedFactor *= spoolFactor;
                  if (spoolFactor > 0.995) bird.spoolT = -1;
              }

              // Dead-zone scale (Section 2.1): 6 reference px in world
              // units. The arrive profile below replaces the old
              // capture-band hover: the bird now decelerates into the
              // target and parks inside a fraction of this zone
              // instead of limit-cycling around it.
              const minDimPx = Math.min(window.innerWidth, window.innerHeight);
              const deadZoneWorld = 6 * (minDimPx / 412) * ((this.host.boundX * 2) / Math.max(1, window.innerWidth));
              bird.hovering = !dashing && !rolling && distToTarget < deadZoneWorld * 1.2 && speedNow < cruiseSpeed * 0.22;

              if (dashing) {
                  // Dash direction is stored screen-space; world y flips.
                  bird.velocity.set(move.dashDirX, -move.dashDirY, 0).multiplyScalar(cruiseSpeed * 2.2);
              } else if (rolling) {
                  bird.velocity.set(move.rollDirX, move.rollDirY, 0).multiplyScalar(cruiseSpeed * 1.4);
              } else {
                  // Arrive-and-park steering (Bird Rebuild): the
                  // desired velocity points at the target with a
                  // magnitude that is cruise far away and ramps
                  // linearly to zero across the last ARRIVE_SECONDS
                  // of travel; velocity integrates toward it under
                  // an acceleration cap. A spring-damper has no
                  // blend-away trap and no orbit: the closer the
                  // bird gets, the slower it is commanded to go, so
                  // it settles on the target and parks. When the
                  // pointer is released the target simply stops
                  // moving and the same settle parks the bird there.
                  const cappedCruise = cruiseSpeed * speedFactor;
                  let desiredSpeed = cappedCruise;
                  const rampSpeed = distToTarget / ARRIVE_SECONDS;
                  if (rampSpeed < desiredSpeed) desiredSpeed = rampSpeed;
                  const desiredVel = desiredDir.clone().multiplyScalar(desiredSpeed);
                  const accelMax = cruiseSpeed * ACCEL_PER_CRUISE * (brakingNow ? 1.5 : 1.0);
                  const delta = desiredVel.sub(bird.velocity);
                  const maxDelta = accelMax * dt;
                  if (delta.length() > maxDelta) delta.setLength(maxDelta);
                  bird.velocity.add(delta);
                  // Park settle: deep inside the dead zone at low
                  // speed, bleed the last of the velocity so the
                  // bird holds its position instead of creeping.
                  if (bird.hovering) {
                      bird.velocity.multiplyScalar(Math.exp(-16 * dt));
                      if (!isAi) bird.flapRate = 0.6;
                  }
                  // Brake presentation: wings spread, flap rate down.
                  if (brakingNow && !isAi) bird.flapRate = Math.min(bird.flapRate, 0.55);
              }
              bird.velocity.z = 0;

              // Delta-time integration: this is the line that makes the
              // crossing time identical on every screen and refresh rate.
              bird.position.add(bird.velocity.clone().multiplyScalar(dt));
              bird.position.z = -15;
              // Side walls: hard stop at the wall face, whatever
              // the velocity (a singularity pull or a dash can
              // still shove the bird, never through the wall).
              if (this.host.wallInsetX > 0) {
                  const maxX = this.host.boundX - this.host.wallInsetX;
                  if (bird.position.x > maxX) bird.position.x = maxX;
                  else if (bird.position.x < -maxX) bird.position.x = -maxX;
              }
          }
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

        // Unified turning controller (Fix Round 4, Carter's spec,
        // Oct 29, 2026). ONE method turns the bird in every case:
        // manual steering, auto-aim while moving, and parked
        // targeting. It replaces the old center-pivot heading ease
        // (velocity follow at a fixed smoothing factor) and the
        // Fix Round 3 parked-only capped rotation.
        //
        // The HEAD leads: bird.headingAngle is the head angle. It
        // turns toward the desired facing at TURNING
        // .headTurnRateDegPerSec (620 deg/s: a 180 degree face
        // change lands in about 0.29 s, as fast as the player can
        // steer). The BODY (bird.bodyAngle) follows through a
        // rate-capped spring, and the render write bends the
        // sprite's spine by their difference, so mid-turn the head
        // is already turned with the body curved behind it.
        //
        // Desired facing: while a mob is inside the auto-fire
        // range (the game publishes its angle on aimTargetAngle),
        // the aim direction and the velocity direction blend by
        // speed as a fraction of live cruise: at or below
        // fullAimSpeedRatio the aim owns the facing (the bird can
        // face and shoot a mob behind it while drifting, flying
        // backwards while shooting forwards at the mob); at or
        // above fullVelocitySpeedRatio the velocity owns it (at
        // speed the bird faces where it flies); smoothstep between.
        // No mob in range: the velocity direction. Parked with
        // nothing in range: straight up, Carter's door-stopper
        // settle from the flight lore and Fix Round 3, now through
        // this same controller. While falling, the facing follows
        // the fall velocity, as the shipped death flow read.
        const velLen = bird.velocity.length();
        const gsT = this.host.gameState;
        const velAngle = velLen > 1e-3 ? Math.atan2(bird.velocity.y, bird.velocity.x) : null;
        let desired: number | null = null;
        if (!isAi && gsT.playerDownPhase() === 'falling') {
            desired = velAngle;
        } else {
            const aim = (!isAi && gsT.activeScreen() === 'game' && !gsT.isPaused() && !gsT.isDeadMenuOpen())
                ? gsT.aimTargetAngle : null;
            if (aim !== null) {
                const cruise = Math.max(1, bird.cruiseSpeedNow || baseSpeed);
                const ratio = velLen / cruise;
                if (velAngle === null) {
                    desired = aim;
                } else {
                    // Speed weight: 0 = aim owns, 1 = velocity owns.
                    const st = Math.min(1, Math.max(0, (ratio - TURNING.fullAimSpeedRatio) / (TURNING.fullVelocitySpeedRatio - TURNING.fullAimSpeedRatio)));
                    const wSpeed = st * st * (3 - 2 * st);
                    // Proximity: a very close mob wins at any speed.
                    const frac = gsT.aimTargetRangeFrac;
                    const pt = Math.min(1, Math.max(0, (frac - TURNING.closeAimRangeFrac) / (TURNING.farAimRangeFrac - TURNING.closeAimRangeFrac)));
                    const w = wSpeed * (pt * pt * (3 - 2 * pt));
                    let dAim = velAngle - aim;
                    while (dAim > Math.PI) dAim -= Math.PI * 2;
                    while (dAim < -Math.PI) dAim += Math.PI * 2;
                    desired = aim + dAim * w;
                }
            } else if (velLen > 0.6 && velAngle !== null) {
                desired = velAngle;
            } else if (bird.hovering) {
                desired = Math.PI / 2;
            } else {
                // Nearly still but not parked (a reversal passing
                // through zero): the heading holds, as the shipped
                // model read, instead of blipping toward up.
                desired = velAngle;
            }
        }
        if (desired !== null) {
            let dH = desired - bird.headingAngle;
            while (dH > Math.PI) dH -= Math.PI * 2;
            while (dH < -Math.PI) dH += Math.PI * 2;
            const maxHeadStep = TURNING.headTurnRateDegPerSec * (Math.PI / 180) * dt;
            bird.headingAngle += Math.max(-maxHeadStep, Math.min(maxHeadStep, dH));
        }
        // Body follow: an exponential approach (bodyFollowTauSec)
        // capped at bodyTurnRateDegPerSec, so the body trails the
        // head through every fast turn and settles onto it after.
        {
            let dB = bird.headingAngle - bird.bodyAngle;
            while (dB > Math.PI) dB -= Math.PI * 2;
            while (dB < -Math.PI) dB += Math.PI * 2;
            const springStep = dB * (1 - Math.exp(-dt / TURNING.bodyFollowTauSec));
            const maxBodyStep = TURNING.bodyTurnRateDegPerSec * (Math.PI / 180) * dt;
            bird.bodyAngle += Math.max(-maxBodyStep, Math.min(maxBodyStep, springStep));
        }
        const headingVec = new THREE.Vector3(Math.cos(bird.headingAngle), Math.sin(bird.headingAngle), 0);
        // Publish the player bird's HEAD angle for the auto-fire
        // facing cone (Fix Round 2 A1; Fix Round 4: the cone
        // centers on the head, since the head is what aims):
        // screen space flips y, so the world-space heading
        // (cos, sin) reads (cos, -sin) in the screen terms the
        // game logic uses. The AI bird does not publish: the cone
        // governs the player's auto-fire.
        if (!isAi) {
            this.host.gameState.phoenixHeading.x = headingVec.x;
            this.host.gameState.phoenixHeading.y = -headingVec.y;
        }
        const rightVec = new THREE.Vector3(headingVec.y, -headingVec.x, 0);
        const vDiff = bird.velocity.clone().sub(bird.previousVelocity);
        const bankGain = 10 / Math.max(0.2, Math.min(frameScale, 5));
        let targetBank = vDiff.dot(rightVec) * bankGain * 0.35;
        targetBank = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, targetBank));
        const drillingNow2 = !isAi && this.host.gameState.isDrilling();
        if (drillingNow2) {
            bird.drillSpin = (bird.drillSpin + 0.5 * frameScale) % (Math.PI * 2);
        } else {
            bird.drillSpin = 0;
            bird.currentBank += (targetBank - bird.currentBank) * (1 - Math.pow(1 - 0.025, frameScale));
        }

        // Air Roll visual (spec Section 2.3): one full barrel rotation
        // across the hop, layered over the bank, turning toward the
        // hop direction.
        const rollMove = isAi ? this.host.gameState.aiMovement
            : (this.host.gameState.activeScreen() === 'game' && this.host.gameState.currentGameMode() === 'ai_vs_ai')
                ? this.host.gameState.ai2Movement : this.host.gameState.playerMovement;
        let extraRoll = 0;
        const rollNowMs = Date.now();
        if (rollNowMs < rollMove.rollUntil) {
            const p = 1 - (rollMove.rollUntil - rollNowMs) / STAMINA.rollMs;
            extraRoll = p * Math.PI * 2 * rollMove.rollSide;
        }
        bird.previousVelocity.copy(bird.velocity);

        // Orientation record for the cosmetic meshes (golden aura,
        // cosmic trail), unchanged from the shipped build: a dummy
        // oriented along the velocity with the bank applied.
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
        dummy.rotateZ(bird.currentBank + extraRoll);

        bird.historyPos.unshift(bird.position.clone());
        bird.historyQuat.unshift(dummy.quaternion.clone());
        if (bird.historyPos.length > this.host.MAX_HISTORY) {
            bird.historyPos.pop(); bird.historyQuat.pop();
        }

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

        if (!this.host.gameState.isPaused() && (!this.host.gameState.isRebirthing() || isAi)) {
            bird.flapTime += 0.04 * frameScale * bird.flapRate;
        }

        bird.trailFade = Math.max(0, Math.min(1, bird.velocity.length() / Math.max(1, baseSpeed * 0.45)));
        this.renderBirdSprite(bird, isAi, histCum, extraRoll, performance.now());

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

  // Place the drawn bird for this substep: main plane, ash plane,
  // ghost ribbon, and glow. The plane's up is the bird's heading in
  // screen space; the anchor puts the drawn head on the physics
  // position (collision and the slaved Matter body read the physics
  // position, never the render position, so the hover bob below is
  // purely cosmetic). Span math matches the shipped core sprite:
  // 0.85 times the 8 * birdScale wingspan, plane aspect 1 by 1.25.
  private renderBirdSprite(bird: PhoenixState, isAi: boolean, histCum: Float32Array, extraRoll: number, nowMs: number) {
      const sprite = bird.sprite;
      if (!sprite) return;
      const skin = isAi ? HOSTILE_SKIN : phoenixSkinById(bird.skinId);
      const frames = getPhoenixFrames(skin);
      const drilling = !isAi && this.host.gameState.isDrilling();
      const frameTex = drilling ? frames.drill : frames.frames[flapFrameIndex(bird.flapTime)];

      const span = 8 * this.host.birdScale * 0.85 * this.host.visScaleMul;
      const len = span * 1.25;
      const anchorBack = (0.5 - PHOENIX_ANCHOR_NZ) * len;
      const headingVec = new THREE.Vector3(Math.cos(bird.headingAngle), Math.sin(bird.headingAngle), 0);
      const inPlane = bird.headingAngle - Math.PI / 2 + bird.currentBank * 0.5 + extraRoll + bird.drillSpin;

      // Spine bend (Fix Round 4): the main and ash planes share
      // the bird's segmented bend geometry. Each vertex row below
      // the neck pivot is rotated in the plane's local frame by a
      // share of the head-to-body angle difference that grows
      // toward the tail (bendCurveExponent), so the drawn body
      // curves behind the head while the head rows stay exact:
      // the head stays pinned on the physics position and leads
      // the turn, the body bends after it. The deflection clamps
      // at bendMaxDeg so extreme reversals stay readable.
      if (bird.bendGeo && bird.bendBase) {
          let bend = bird.bodyAngle - bird.headingAngle;
          while (bend > Math.PI) bend -= Math.PI * 2;
          while (bend < -Math.PI) bend += Math.PI * 2;
          const maxBend = TURNING.bendMaxDeg * Math.PI / 180;
          bend = Math.max(-maxBend, Math.min(maxBend, bend));
          const neckY = (0.5 - TURNING.bendNeckNz) * 1.25;
          const posAttr = bird.bendGeo.attributes['position'] as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          const base = bird.bendBase;
          for (let i = 0; i < arr.length; i += 3) {
              const bx = base[i], by = base[i + 1];
              if (by >= neckY || bend === 0) {
                  arr[i] = bx; arr[i + 1] = by; arr[i + 2] = base[i + 2];
                  continue;
              }
              const t = (neckY - by) / (neckY + 0.625);
              const th = bend * Math.pow(t, TURNING.bendCurveExponent);
              const cos = Math.cos(th), sin = Math.sin(th);
              const dy = by - neckY;
              arr[i] = bx * cos - dy * sin;
              arr[i + 1] = neckY + bx * sin + dy * cos;
              arr[i + 2] = base[i + 2];
          }
          posAttr.needsUpdate = true;
      }

      // Hover bob (render only): a gentle vertical settle while
      // parked, a subtler one in cruise, nearly none mid-dash.
      const bobAmp = this.host.birdScale * (bird.hovering ? 0.16 : 0.07) * (bird.wasDashing ? 0.3 : 1);
      const bobY = Math.sin(nowMs * 0.0021 + (isAi ? 2.1 : 0)) * bobAmp;
      let jx = 0, jy = 0;
      if (bird.renderAshMix > 0) {
          jx = (Math.random() - 0.5) * 0.09;
          jy = (Math.random() - 0.5) * 0.09;
      }
      const cx = bird.position.x + jx;
      const cy = bird.position.y + bobY + jy;

      const mainMat = sprite.material as THREE.MeshBasicMaterial;
      if (mainMat.map !== frameTex) { mainMat.map = frameTex; mainMat.needsUpdate = true; }
      mainMat.color.copy(bird.renderTint);
      mainMat.opacity = 0.95 * bird.renderOpacity * (1 - bird.renderAshMix);
      sprite.position.set(cx - headingVec.x * anchorBack, cy - headingVec.y * anchorBack, bird.position.z);
      sprite.rotation.set(0, 0, inPlane);
      sprite.scale.set(span, span, span);
      sprite.visible = bird.group.visible && bird.renderAshMix < 1;

      const ash = bird.ashSprite;
      if (ash) {
          const ashMat = ash.material as THREE.MeshBasicMaterial;
          if (bird.renderAshMix > 0) {
              const ashFrames = ensureAshFrames(skin);
              const ashTex = drilling ? ashFrames.ashDrill : ashFrames.ashFrames[flapFrameIndex(bird.flapTime)];
              if (ashMat.map !== ashTex) { ashMat.map = ashTex; ashMat.needsUpdate = true; }
          }
          ashMat.opacity = 0.95 * bird.renderOpacity * bird.renderAshMix;
          ash.position.copy(sprite.position);
          ash.rotation.copy(sprite.rotation);
          ash.scale.copy(sprite.scale);
          ash.visible = bird.group.visible && bird.renderAshMix > 0;
      }

      // Ghost ribbon: a short fading trail of recent positions,
      // placed by arc length along the recorded path (the Fix Round
      // 1 sampling), each ghost a smaller, fainter copy of the bird.
      // The ribbon is a motion trail: its strength follows the live
      // speed (trailFade), so a parked bird carries no ribbon at
      // all instead of a frozen smear along its arrival path.
      //
      // Worlds pass (Carter, Oct 29, 2026): the ribbon used to keep
      // its own heading, derived from the recorded path, on flat
      // geometry, so while the main body turned to aim the shadow
      // layer underneath kept pointing along the old flight path
      // and never bent. The ghosts now take the main plane's exact
      // rotation for this frame (same head angle, same bank, same
      // roll and drill spin) and share its bend geometry (assigned
      // at creation), so the layer carries the same head direction
      // and spine bend as the body it trails: one bird, echoed.
      // Only the positions still come from the path history, which
      // is what makes it a trail.
      const ghostStep = this.host.birdScale * 0.66;
      const histTotal = histCum.length > 0 ? histCum[histCum.length - 1] : 0;
      for (let i = 0; i < bird.ghostSprites.length; i++) {
          const ghost = bird.ghostSprites[i];
          const gm = ghost.material as THREE.MeshBasicMaterial;
          const distBack = (i + 1) * ghostStep;
          const spanFade = Math.min(1, histTotal / Math.max(0.001, ghostStep * bird.ghostSprites.length));
          const opacity = 0.17 * (1 - i / Math.max(1, bird.ghostSprites.length)) * spanFade * bird.trailFade * bird.renderOpacity * (1 - bird.renderAshMix);
          if (opacity <= 0.01 || !bird.group.visible) { ghost.visible = false; continue; }
          let lo = 0, hi = histCum.length - 1;
          while (lo < hi) {
              const mid = (lo + hi + 1) >> 1;
              if (histCum[mid] <= distBack) lo = mid; else hi = mid - 1;
          }
          const hPos = bird.historyPos[lo];
          const gSpan = span * (1 - 0.055 * (i + 1));
          if (gm.map !== frameTex) { gm.map = frameTex; gm.needsUpdate = true; }
          gm.color.copy(bird.renderTint);
          gm.opacity = opacity;
          ghost.position.set(
              hPos.x - headingVec.x * anchorBack * (gSpan / span),
              hPos.y + bobY * (1 - i * 0.08) - headingVec.y * anchorBack * (gSpan / span),
              bird.position.z);
          ghost.rotation.set(0, 0, inPlane);
          ghost.scale.set(gSpan, gSpan, gSpan);
          ghost.visible = true;
      }

      // Keep the visibility glow centred on the bird, sized to the
      // wingspan (per-skin span, spec 2.4), blinking in step with
      // the bird during i-frames.
      if (bird.glow) {
          bird.glow.position.copy(bird.position);
          const glowSpan = 8 * this.host.birdScale * bird.glowSpanFactor;
          bird.glow.scale.set(glowSpan, glowSpan, 1);
          bird.glow.visible = bird.group.visible && bird.renderAshMix < 1;
          if (!isAi) {
              const gm = bird.glow.material as THREE.SpriteMaterial;
              let glowOpacity = 0.36 * bird.renderOpacity;
              if (this.host.gameState.activeScreen() === 'menu') glowOpacity *= 0.8; // calmer menu glow (spec 2.2)
              if (bird.climbTime > 0.4 && this.host.gameState.activeScreen() === 'game') glowOpacity *= 1.2; // flap burst glow (spec 2.2)
              gm.opacity = glowOpacity;
          }
      }
  }
}
