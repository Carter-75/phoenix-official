import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { MOVE_BY_ID, SKIN_BY_ID, WORLDS } from '../data/catalog';
import { audio } from '../services/audio';
import { useMonetization } from '../services/monetization';
import { useGame } from '../state/GameContext';
import { hasActiveBoost } from '../state/types';
import { PhoenixSprite } from './PhoenixSprite';

// One engine for Campaign (waves + named boss) and Battle (1v1 AI phoenix).
// Single requestAnimationFrame loop, circle collision, everything gated on
// `paused` (the Phoenix-Fall bug was physics running during its pause).
//
// Controls: drag anywhere to steer (touch start also steers, fixing the
// Phoenix-Fall hold bug). Double tap fires the double move, triple tap the
// triple move, and the HOLD button channels the hold move. Buttons for the
// double and triple moves sit next to HOLD so nothing depends on gestures.

type Phase = 'playing' | 'paused' | 'revive' | 'won' | 'lost';

interface Ent {
  id: number;
  kind: 'chaser' | 'shooter' | 'tank' | 'boss' | 'rival';
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  r: number;
  fireAt: number;
  t: number;
}
interface Bolt {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  friendly: boolean;
  big?: boolean;
  color: string;
}
interface Particle {
  id: number;
  x: number;
  y: number;
  life: number;
  color: string;
  size: number;
}

let nextId = 1;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
// Temp-phoenix cooldowns run up to 10 minutes, which would make top moves
// unusable inside a run. In-run cooldown is clamped to 1.2s..30s.
const inRunCooldown = (ms: number) => clamp(ms, 1200, 30_000);

export function GameScreen({ mode, worldId }: { mode: 'campaign' | 'battle'; worldId: number }) {
  const game = useGame();
  const monetization = useMonetization();
  const { width, height } = useWindowDimensions();
  const world = useMemo(() => WORLDS.find((w) => w.id === worldId) || WORLDS[0], [worldId]);
  const skin = SKIN_BY_ID[game.progress.activeSkin] || SKIN_BY_ID.ember;
  const maxHp = 100 + (game.progress.level - 1) * 10;
  const boosted = hasActiveBoost(game.progress);

  const [phase, setPhase] = useState<Phase>('playing');
  const phaseRef = useRef<Phase>('playing');
  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const [, setFrame] = useState(0);

  const player = useRef({ x: width / 2, y: height * 0.78, hp: maxHp, invulnUntil: 0 });
  const target = useRef({ x: width / 2, y: height * 0.78 });
  const enemies = useRef<Ent[]>([]);
  const bolts = useRef<Bolt[]>([]);
  const particles = useRef<Particle[]>([]);
  const wave = useRef(0);
  const spawnedInWave = useRef(0);
  const kills = useRef(0);
  const score = useRef(0);
  const coinsEarned = useRef(0);
  const startedAt = useRef(Date.now());
  const lastShotAt = useRef(0);
  const lastTrailAt = useRef(0);
  const bossSpawned = useRef(false);
  const revived = useRef(false);
  const finished = useRef(false);
  const holding = useRef(false);
  const cooldowns = useRef<{ hold: number; double: number; triple: number }>({ hold: 0, double: 0, triple: 0 });
  const tapTimes = useRef<number[]>([]);
  const rewardsGranted = useRef(false);

  const equipped = game.progress.equippedMoves;
  const holdMove = MOVE_BY_ID[equipped.hold];
  const doubleMove = MOVE_BY_ID[equipped.double];
  const tripleMove = MOVE_BY_ID[equipped.triple];

  const finishRun = useCallback(
    (won: boolean) => {
      if (finished.current) return;
      finished.current = true;
      const timeSec = Math.floor((Date.now() - startedAt.current) / 1000);
      const mult = boosted ? 2 : 1;
      const coinReward = Math.floor(coinsEarned.current * mult);
      const xpReward = Math.floor((kills.current * 6 + (won ? 120 + worldId * 30 : 20)) * mult);
      game.addCoins(coinReward);
      game.gainXp(xpReward);
      if (mode === 'campaign') {
        game.recordWorldRun(worldId, score.current, timeSec, won);
      } else {
        game.recordBattle(won, score.current);
      }
      if (!won) game.recordDeath();
      rewardsGranted.current = true;
      setPhaseBoth(won ? 'won' : 'lost');
      monetization.maybeShowInterstitial().catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, worldId, boosted]
  );

  const damagePlayer = useCallback(
    (dmg: number) => {
      const now = Date.now();
      if (now < player.current.invulnUntil || phaseRef.current !== 'playing') return;
      player.current.hp -= dmg;
      audio.play('playerHit');
      game.haptic();
      if (player.current.hp <= 0) {
        player.current.hp = 0;
        if (!revived.current) {
          setPhaseBoth('revive');
        } else {
          finishRun(false);
        }
      }
    },
    [finishRun, game]
  );

  const spawnWave = useCallback(() => {
    wave.current += 1;
    spawnedInWave.current = 0;
    const count = mode === 'battle' ? 0 : 4 + world.id + wave.current;
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      const kind: Ent['kind'] = roll < 0.5 ? 'chaser' : roll < 0.8 ? 'shooter' : 'tank';
      const hpBase = world.enemyHealth * (kind === 'tank' ? 4 : kind === 'shooter' ? 1.6 : 1) * (1 + wave.current * 0.12);
      enemies.current.push({
        id: nextId++,
        kind,
        x: 40 + Math.random() * (width - 80),
        y: -40 - i * 55,
        vx: 0,
        vy: kind === 'tank' ? 0.45 : kind === 'shooter' ? 0.6 : 1.0,
        hp: hpBase,
        maxHp: hpBase,
        r: kind === 'tank' ? 30 : 20,
        fireAt: Date.now() + 1200 + Math.random() * 1800,
        t: Math.random() * 1000,
      });
      spawnedInWave.current += 1;
    }
    if (mode === 'battle' && !bossSpawned.current) {
      bossSpawned.current = true;
      enemies.current.push({
        id: nextId++,
        kind: 'rival',
        x: width / 2,
        y: 110,
        vx: 1.6,
        vy: 0,
        hp: maxHp * 6,
        maxHp: maxHp * 6,
        r: 30,
        fireAt: Date.now() + 1200,
        t: 0,
      });
      audio.play('boss');
    }
  }, [mode, world, width, maxHp]);

  const spawnBoss = useCallback(() => {
    bossSpawned.current = true;
    enemies.current.push({
      id: nextId++,
      kind: 'boss',
      x: width / 2,
      y: 100,
      vx: 1.2 + world.id * 0.08,
      vy: 0,
      hp: world.bossHealth,
      maxHp: world.bossHealth,
      r: 46,
      fireAt: Date.now() + 1000,
      t: 0,
    });
    game.addCodex(`boss_${world.id}`);
    audio.play('boss');
  }, [world, width, game]);

  const fireMove = useCallback(
    (slot: 'double' | 'triple') => {
      const now = Date.now();
      if (phaseRef.current !== 'playing' || now < cooldowns.current[slot]) return;
      const move = slot === 'double' ? doubleMove : tripleMove;
      cooldowns.current[slot] = now + inRunCooldown(move.cooldownMs);
      const p = player.current;
      if (slot === 'double') {
        bolts.current.push({ id: nextId++, x: p.x, y: p.y - 30, vx: 0, vy: -11, dmg: move.damage, friendly: true, big: true, color: move.color });
        audio.play('shoot');
      } else {
        for (const dx of [-3.2, 0, 3.2]) {
          bolts.current.push({ id: nextId++, x: p.x, y: p.y - 30, vx: dx, vy: -9.5, dmg: move.damage / 2, friendly: true, big: true, color: move.color });
        }
        // plus a shockwave that chips everything on screen
        for (const e of enemies.current) e.hp -= move.damage / 4;
        audio.play('beam');
      }
    },
    [doubleMove, tripleMove]
  );

  // Main loop
  useEffect(() => {
    let raf = 0;
    let last = Date.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = Date.now();
      const dt = Math.min(50, now - last);
      last = now;
      if (phaseRef.current !== 'playing') return;
      const p = player.current;
      const step = dt / 16.7;

      // steer toward touch target
      p.x += (target.current.x - p.x) * Math.min(1, 0.35 * step);
      p.y += (target.current.y - p.y) * Math.min(1, 0.35 * step);
      p.x = clamp(p.x, 24, width - 24);
      p.y = clamp(p.y, height * 0.25, height - 90);

      // trail particles
      if (now - lastTrailAt.current > 50) {
        lastTrailAt.current = now;
        particles.current.push({ id: nextId++, x: p.x + (Math.random() - 0.5) * 14, y: p.y + 26, life: 1, color: skin.primary, size: 5 + Math.random() * 5 });
      }

      // auto fire
      if (now - lastShotAt.current > 230) {
        lastShotAt.current = now;
        bolts.current.push({ id: nextId++, x: p.x, y: p.y - 30, vx: 0, vy: -10, dmg: 10 + Math.floor(game.progress.level / 2), friendly: true, color: skin.secondary });
      }

      // hold beam: continuous damage in a column while held and off cooldown
      if (holding.current && now >= cooldowns.current.hold) {
        let hitAny = false;
        for (const e of enemies.current) {
          if (Math.abs(e.x - p.x) < 30 + e.r && e.y < p.y) {
            e.hp -= (holdMove.damage / 6) * step;
            hitAny = true;
          }
        }
        if (hitAny && Math.random() < 0.3) audio.play('beam');
        // beam drains over 2.5s then goes on cooldown
        cooldowns.current.hold = Math.max(cooldowns.current.hold, now + 40);
        (loop as any)._beamTime = ((loop as any)._beamTime || 0) + dt;
        if ((loop as any)._beamTime > 2500) {
          (loop as any)._beamTime = 0;
          holding.current = false;
          cooldowns.current.hold = now + inRunCooldown(holdMove.cooldownMs);
        }
      }

      // waves and boss flow
      if (mode === 'campaign') {
        if (enemies.current.length === 0 && !bossSpawned.current) {
          if (wave.current < world.waveCount) spawnWave();
          else spawnBoss();
        }
      } else if (enemies.current.length === 0 && !bossSpawned.current) {
        spawnWave();
      }

      // enemies
      for (const e of enemies.current) {
        e.t += dt;
        if (e.kind === 'chaser') {
          e.y += e.vy * step;
          e.x += clamp(p.x - e.x, -1.4, 1.4) * step;
        } else if (e.kind === 'shooter') {
          e.y += e.vy * step;
          e.x += Math.sin(e.t / 600) * 0.7 * step;
          if (now > e.fireAt && e.y > 0 && e.y < height * 0.6) {
            e.fireAt = now + 2100 - Math.min(900, world.id * 70);
            bolts.current.push({ id: nextId++, x: e.x, y: e.y + 18, vx: clamp((p.x - e.x) / 220, -2, 2), vy: 4.6, dmg: world.enemyDamage, friendly: false, color: world.color });
          }
        } else if (e.kind === 'tank') {
          e.y += e.vy * step;
        } else if (e.kind === 'boss') {
          e.x += e.vx * step;
          if (e.x < 60 || e.x > width - 60) e.vx *= -1;
          e.y = 100 + Math.sin(e.t / 700) * 22;
          if (now > e.fireAt) {
            e.fireAt = now + Math.max(620, 1500 - world.id * 80);
            const pattern = Math.floor(e.t / 3000) % 3;
            if (pattern === 0) {
              for (const dx of [-2.4, 0, 2.4]) bolts.current.push({ id: nextId++, x: e.x, y: e.y + 40, vx: dx, vy: 4.4, dmg: world.enemyDamage + 4, friendly: false, color: world.color });
            } else if (pattern === 1) {
              bolts.current.push({ id: nextId++, x: e.x, y: e.y + 40, vx: clamp((p.x - e.x) / 130, -3.4, 3.4), vy: 5.2, dmg: world.enemyDamage + 6, friendly: false, big: true, color: world.color });
            } else {
              for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2 + e.t / 900;
                bolts.current.push({ id: nextId++, x: e.x, y: e.y, vx: Math.cos(a) * 2.6, vy: Math.abs(Math.sin(a)) * 3 + 1.4, dmg: world.enemyDamage, friendly: false, color: world.color });
              }
            }
          }
        } else if (e.kind === 'rival') {
          e.x += e.vx * step;
          if (e.x < 50 || e.x > width - 50 || Math.random() < 0.008) e.vx *= -1;
          e.y = 110 + Math.sin(e.t / 500) * 30;
          if (now > e.fireAt) {
            e.fireAt = now + 1050;
            bolts.current.push({ id: nextId++, x: e.x, y: e.y + 26, vx: clamp((p.x - e.x) / 200, -2.6, 2.6), vy: 5.4, dmg: 11, friendly: false, big: Math.random() < 0.3, color: '#c44dff' });
          }
        }
        // contact damage
        const distP = Math.hypot(e.x - p.x, e.y - p.y);
        if (distP < e.r + 22) {
          e.hp -= 30;
          damagePlayer(e.kind === 'boss' || e.kind === 'rival' ? 18 : world.enemyDamage + 4);
          p.y = Math.min(height - 90, p.y + 26);
        }
        if (e.y > height + 60) e.hp = -9999; // escaped: remove without reward
      }

      // bolts
      for (const b of bolts.current) {
        b.x += b.vx * step;
        b.y += b.vy * step;
        if (b.friendly) {
          for (const e of enemies.current) {
            if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + (b.big ? 10 : 6)) {
              e.hp -= b.dmg;
              b.y = -9999;
              audio.play('hit');
              break;
            }
          }
        } else if (Math.hypot(p.x - b.x, p.y - b.y) < 24) {
          b.y = height + 9999;
          damagePlayer(b.dmg);
        }
      }
      bolts.current = bolts.current.filter((b) => b.y > -80 && b.y < height + 80 && b.x > -40 && b.x < width + 40);

      // deaths
      const before = enemies.current.length;
      enemies.current = enemies.current.filter((e) => {
        if (e.hp > 0) return true;
        if (e.hp === -9999) return false;
        kills.current += 1;
        score.current += e.kind === 'boss' ? 5000 : e.kind === 'rival' ? 3000 : e.kind === 'tank' ? 250 : e.kind === 'shooter' ? 150 : 100;
        coinsEarned.current += e.kind === 'boss' ? 150 + world.id * 25 : e.kind === 'rival' ? 120 : e.kind === 'tank' ? 8 : 4;
        game.addCodex(e.kind === 'boss' ? `boss_${world.id}` : e.kind);
        for (let i = 0; i < 8; i++) {
          particles.current.push({ id: nextId++, x: e.x + (Math.random() - 0.5) * 30, y: e.y + (Math.random() - 0.5) * 30, life: 1, color: world.color, size: 4 + Math.random() * 7 });
        }
        audio.play('explosion');
        if (e.kind === 'boss' || e.kind === 'rival') {
          finishRun(true);
        }
        return false;
      });
      void before;

      // particles decay
      for (const pt of particles.current) {
        pt.life -= 0.03 * step;
        pt.y += 1.1 * step;
      }
      particles.current = particles.current.filter((pt) => pt.life > 0);

      setFrame((f) => f + 1);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, mode]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          target.current = { x: locationX, y: locationY - 40 };
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          target.current = { x: locationX, y: locationY - 40 };
        },
        onPanResponderRelease: (evt) => {
          // tap detection for double / triple moves
          const now = Date.now();
          tapTimes.current = [...tapTimes.current.filter((t) => now - t < 700), now];
          if (tapTimes.current.length >= 3) {
            tapTimes.current = [];
            fireMove('triple');
          } else if (tapTimes.current.length === 2) {
            setTimeout(() => {
              if (tapTimes.current.length === 2) {
                tapTimes.current = [];
                fireMove('double');
              }
            }, 260);
          }
        },
      }),
    [fireMove]
  );

  const onRevive = async () => {
    const ok = await monetization.showRewarded('revive');
    if (ok) {
      revived.current = true;
      player.current.hp = Math.floor(maxHp / 2);
      player.current.invulnUntil = Date.now() + 2500;
      bolts.current = bolts.current.filter((b) => b.friendly);
      audio.play('revive');
      setPhaseBoth('playing');
    } else {
      finishRun(false);
    }
  };

  const bossEnt = enemies.current.find((e) => e.kind === 'boss' || e.kind === 'rival');
  const cd = cooldowns.current;
  const nowMs = Date.now();
  const cdLeft = (slot: 'hold' | 'double' | 'triple', moveMs: number) => {
    const left = cd[slot] - nowMs;
    return left <= 0 ? 0 : Math.ceil(left / 100) / 10;
  };

  return (
    <View style={[styles.root, { backgroundColor: world.dark }]} {...pan.panHandlers}>
      {/* ambient stars */}
      {particles.current.map((pt) => (
        <View key={pt.id} style={[styles.particle, { left: pt.x, top: pt.y, width: pt.size, height: pt.size, backgroundColor: pt.color, opacity: pt.life }]} />
      ))}

      {/* enemies */}
      {enemies.current.map((e) => (
        <View key={e.id} style={{ position: 'absolute', left: e.x - e.r, top: e.y - e.r }}>
          {e.kind === 'rival' ? (
            <PhoenixSprite skin={SKIN_BY_ID.eclipse} size={64} flap={Math.abs(Math.sin(e.t / 180))} />
          ) : (
            <View
              style={[
                styles.enemyBody,
                {
                  width: e.r * 2,
                  height: e.r * 2,
                  borderRadius: e.kind === 'boss' ? 18 : e.r,
                  backgroundColor: world.color,
                  opacity: 0.55 + 0.45 * (e.hp / e.maxHp),
                },
              ]}
            >
              <Text style={styles.enemyGlyph}>{e.kind === 'boss' ? 'BOSS' : e.kind === 'tank' ? '⬢' : e.kind === 'shooter' ? '◆' : '▼'}</Text>
            </View>
          )}
          {(e.kind === 'tank' || e.kind === 'shooter') && (
            <View style={styles.miniBarBg}>
              <View style={[styles.miniBarFill, { width: `${Math.max(0, (e.hp / e.maxHp) * 100)}%` }]} />
            </View>
          )}
        </View>
      ))}

      {/* hold beam */}
      {holding.current && (
        <View style={[styles.beam, { left: player.current.x - 7, height: player.current.y, top: 0, backgroundColor: holdMove.color }]} />
      )}

      {/* bolts */}
      {bolts.current.map((b) => (
        <View
          key={b.id}
          style={[
            styles.bolt,
            {
              left: b.x - (b.big ? 6 : 3.5),
              top: b.y - (b.big ? 10 : 7),
              width: b.big ? 12 : 7,
              height: b.big ? 20 : 14,
              backgroundColor: b.color,
            },
          ]}
        />
      ))}

      {/* player */}
      <View style={{ position: 'absolute', left: player.current.x - 28, top: player.current.y - 28, opacity: nowMs < player.current.invulnUntil ? 0.55 : 1 }}>
        <PhoenixSprite skin={skin} size={56} flap={Math.abs(Math.sin(nowMs / 140))} />
      </View>

      {/* HUD */}
      <View style={styles.hud}>
        <View style={styles.hudRow}>
          <Text style={styles.hudText}>{mode === 'battle' ? 'BATTLE' : `${world.name} - ${world.boss}`}</Text>
          <TouchableOpacity
            style={styles.pauseBtn}
            onPress={() => {
              if (phase === 'playing') setPhaseBoth('paused');
              else if (phase === 'paused') setPhaseBoth('playing');
            }}
          >
            <Text style={styles.pauseText}>{phase === 'paused' ? 'Resume' : 'II'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.hpBg}>
          <View style={[styles.hpFill, { width: `${Math.max(0, (player.current.hp / maxHp) * 100)}%` }]} />
        </View>
        <Text style={styles.hudSub}>
          HP {Math.max(0, Math.ceil(player.current.hp))}/{maxHp} - Score {score.current} - Coins +{coinsEarned.current}
          {mode === 'campaign' && !bossSpawned.current ? ` - Wave ${Math.min(wave.current + 1, world.waveCount)}/${world.waveCount}` : ''}
          {boosted ? ' - 2x BOOST' : ''}
        </Text>
        {bossEnt && (
          <>
            <Text style={[styles.hudSub, { color: '#ff8080' }]}>{bossEnt.kind === 'boss' ? world.boss : 'Rival Phoenix'}</Text>
            <View style={[styles.hpBg, { borderColor: '#ff5252' }]}>
              <View style={[styles.hpFill, { backgroundColor: '#ff5252', width: `${Math.max(0, (bossEnt.hp / bossEnt.maxHp) * 100)}%` }]} />
            </View>
          </>
        )}
      </View>

      {/* move buttons */}
      {phase === 'playing' && (
        <View style={styles.controls}>
          <TouchableOpacity style={styles.moveBtn} onPress={() => fireMove('double')}>
            <Text style={styles.moveName}>DOUBLE</Text>
            <Text style={styles.moveSub}>{cdLeft('double', doubleMove.cooldownMs) > 0 ? `${cdLeft('double', doubleMove.cooldownMs)}s` : doubleMove.name}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.moveBtn, styles.holdBtn]}
            onPressIn={() => {
              holding.current = true;
            }}
            onPressOut={() => {
              holding.current = false;
              cooldowns.current.hold = Date.now() + inRunCooldown(holdMove.cooldownMs);
            }}
          >
            <Text style={styles.moveName}>HOLD</Text>
            <Text style={styles.moveSub}>{holdMove.name}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.moveBtn} onPress={() => fireMove('triple')}>
            <Text style={styles.moveName}>TRIPLE</Text>
            <Text style={styles.moveSub}>{cdLeft('triple', tripleMove.cooldownMs) > 0 ? `${cdLeft('triple', tripleMove.cooldownMs)}s` : tripleMove.name}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'paused' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Paused</Text>
          <TouchableOpacity style={styles.overlayBtn} onPress={() => setPhaseBoth('playing')}>
            <Text style={styles.overlayBtnText}>Resume</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.overlayBtnAlt} onPress={() => game.go(mode === 'battle' ? 'menu' : 'worlds')}>
            <Text style={styles.overlayBtnText}>Quit run</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'revive' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Your phoenix has fallen</Text>
          <Text style={styles.overlayBody}>Watch a short ad to rise from the ashes with half health and keep this run going.</Text>
          <TouchableOpacity style={styles.overlayBtn} onPress={onRevive}>
            <Text style={styles.overlayBtnText}>Watch Ad - Revive</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.overlayBtnAlt} onPress={() => finishRun(false)}>
            <Text style={styles.overlayBtnText}>Give up the run</Text>
          </TouchableOpacity>
        </View>
      )}

      {(phase === 'won' || phase === 'lost') && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>{phase === 'won' ? (mode === 'battle' ? 'Battle won!' : `${world.boss} defeated!`) : 'Run over'}</Text>
          <Text style={styles.overlayBody}>
            Score {score.current} - Kills {kills.current} - Coins earned this run {coinsEarned.current}
            {boosted ? ' (2x boost applied to rewards)' : ''}
          </Text>
          <TouchableOpacity style={styles.overlayBtn} onPress={() => game.go(mode === 'battle' ? 'menu' : 'worlds')}>
            <Text style={styles.overlayBtnText}>{mode === 'battle' ? 'Back to menu' : 'Back to worlds'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.overlayBtnAlt} onPress={() => game.go('menu')}>
            <Text style={styles.overlayBtnText}>Main menu</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  particle: { position: 'absolute', borderRadius: 99 },
  enemyBody: { alignItems: 'center', justifyContent: 'center' },
  enemyGlyph: { color: '#fff', fontWeight: '900', fontSize: 13 },
  miniBarBg: { height: 4, backgroundColor: '#00000088', borderRadius: 2, marginTop: 2, overflow: 'hidden' },
  miniBarFill: { height: 4, backgroundColor: '#ff5252' },
  beam: { position: 'absolute', width: 14, opacity: 0.75, borderRadius: 7 },
  bolt: { position: 'absolute', borderRadius: 4 },
  hud: { position: 'absolute', top: 10, left: 12, right: 12 },
  hudRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hudText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hudSub: { color: '#cfc6ee', fontSize: 12, marginTop: 3 },
  pauseBtn: { backgroundColor: '#00000077', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  pauseText: { color: '#fff', fontWeight: '800' },
  hpBg: { height: 12, backgroundColor: '#00000088', borderRadius: 6, borderWidth: 1, borderColor: '#ffffff33', marginTop: 6, overflow: 'hidden' },
  hpFill: { height: 12, backgroundColor: '#39d98a' },
  controls: { position: 'absolute', bottom: 16, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  moveBtn: { flex: 1, backgroundColor: '#17102ecc', borderColor: '#ff6a00', borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  holdBtn: { backgroundColor: '#3a1503dd' },
  moveName: { color: '#ffb347', fontWeight: '900', fontSize: 13 },
  moveSub: { color: '#fff', fontSize: 10, marginTop: 1 },
  overlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(5,2,14,0.88)', alignItems: 'center', justifyContent: 'center', padding: 26 },
  overlayTitle: { color: '#fff', fontSize: 26, fontWeight: '900', textAlign: 'center', marginBottom: 10 },
  overlayBody: { color: '#cfc6ee', fontSize: 15, textAlign: 'center', marginBottom: 18, lineHeight: 21 },
  overlayBtn: { backgroundColor: '#ff6a00', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 26, marginVertical: 5, minWidth: 240, alignItems: 'center' },
  overlayBtnAlt: { backgroundColor: '#2d2154', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 26, marginVertical: 5, minWidth: 240, alignItems: 'center' },
  overlayBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
