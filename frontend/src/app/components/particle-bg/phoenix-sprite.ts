// Drawn phoenix sprite frames (Bird Rebuild Round, Oct 28, 2026).
//
// Carter's device verdict on the particle bird: on his phone the
// phoenix rendered as a pixelated flame blob with no readable bird
// shape, twice. The bird is therefore no longer built out of points
// at all. It is a drawn phoenix: vector paths (crested head and beak,
// breast, two swept wings with individual primaries, layered tail
// plumes) rendered once per skin onto offscreen canvases at 768 by
// 960 (the on-screen bird is about 80 CSS px wide on a 360 px phone,
// about 240 device px at DPR 3, so the texture is over 3x its display
// size and stays crisp), pre-rendering a full flap cycle plus a swept
// drill pose and an ash set for the death and rebirth sequences. In
// the scene the bird is one textured plane per layer (main, ash,
// fading ghost ribbon) oriented in screen space: the plane's up is
// the bird's heading, so the phoenix reads as a bird from the game's
// camera at every heading, which the old formation (whose wing axis
// mapped to world depth) never could.
//
// The drawing was revised once against harness screenshots in this
// round: a first version smoothed the wing outline into rounded
// ovals that read as a moth, so the wings are now built feather by
// feather with a sharp tip and scalloped primaries, the body is
// slimmer, and the tail plumes are wide layered leaves that stay
// bright enough to read against the dark sky.
//
// Skins stay the existing per-world palette records: the draw takes
// the skin's bright, mid, and deep bands plus its glyph treatments
// (crest style, angular, serrated, dark heart, facets, sparkles,
// broad wings), so all six skins and the per-world mapping work
// unchanged and no skin data lives here.
import * as THREE from 'three';
import { PhoenixSkin, Rgb3 } from './phoenix-skins';

export const PHOENIX_TEX_W = 768;
export const PHOENIX_TEX_H = 960;
export const PHOENIX_FLAP_FRAMES = 8;
// Glyph-space height at which the bird's physics position sits in
// the texture: just behind the beak, at the head. The render code
// anchors the plane so this point lands on the bird position.
export const PHOENIX_ANCHOR_NZ = 0.10;

const ASH_PALETTE = {
  bright: [0.88, 0.88, 0.90] as Rgb3,
  mid: [0.52, 0.52, 0.55] as Rgb3,
  deep: [0.23, 0.23, 0.26] as Rgb3,
};

export interface PhoenixFrameSet {
  frames: THREE.CanvasTexture[];
  drill: THREE.CanvasTexture;
  ashFrames: THREE.CanvasTexture[];
  ashDrill: THREE.CanvasTexture;
}

const frameCache = new Map<string, PhoenixFrameSet>();

function css(c: Rgb3, a = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}

function mix(a: Rgb3, b: Rgb3, t: number): Rgb3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Draw one phoenix frame. lift in [-1, 1]: 1 wings fully raised,
// -1 wings fully pressed down. sweep in [0, 1]: wings swept back
// along the body (the drill pose). Coordinates follow the glyph
// convention: nx -1..1 across the wings, nz 0 at the beak tip to 1
// at the tail plume tips.
function drawPhoenixFrame(
  skin: PhoenixSkin,
  pal: { bright: Rgb3; mid: Rgb3; deep: Rgb3 },
  lift: number,
  sweep: number,
  ash: boolean,
): HTMLCanvasElement {
  const W = PHOENIX_TEX_W, H = PHOENIX_TEX_H;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const px = (nx: number) => W / 2 + nx * (W * 0.47);
  const py = (nz: number) => 30 + nz * (H - 60);
  const wingSpread = (skin.glyph.broadWings ? 1.08 : 1.0) * (1 - 0.10 * sweep);

  // ---- Tail plumes (behind everything): five wide layered plumes
  // fanning from the body's end, each a pointed leaf with a bright
  // centre vein, plus four shorter inner plumes between them. The
  // gradient runs mid at the root to a bright-mid mix at the tips
  // so the tail stays readable against the dark sky.
  const plume = (tipX: number, tipZ: number, wid: number, baseX: number, root: Rgb3, tip: Rgb3, veinA: number) => {
    const baseZ = 0.575;
    const midZ = baseZ + (tipZ - baseZ) * 0.55;
    const midX = baseX + (tipX - baseX) * 0.55;
    const path = new Path2D();
    path.moveTo(px(baseX), py(baseZ));
    path.quadraticCurveTo(px(midX - wid), py(midZ), px(tipX), py(tipZ));
    path.quadraticCurveTo(px(midX + wid), py(midZ), px(baseX), py(baseZ));
    path.closePath();
    const tg = ctx.createLinearGradient(0, py(baseZ), 0, py(tipZ));
    tg.addColorStop(0, css(root));
    tg.addColorStop(1, css(tip));
    ctx.fillStyle = tg;
    ctx.fill(path);
    ctx.strokeStyle = css(pal.bright, veinA);
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(px(baseX), py(baseZ));
    ctx.quadraticCurveTo(px(midX), py(midZ), px(tipX), py(tipZ - 0.012));
    ctx.stroke();
  };
  for (let i = -2; i <= 2; i++) {
    const sway = Math.sin(lift * 1.2 + i * 0.55) * 0.012;
    plume(i * 0.135 + sway, 0.975 - Math.abs(i) * 0.035 - sweep * 0.01, 0.082 - Math.abs(i) * 0.008, i * 0.018,
      pal.mid, mix(pal.mid, pal.bright, 0.45), ash ? 0.2 : 0.5);
  }
  for (let i = -1.5; i <= 1.5; i++) {
    plume(i * 0.115, 0.86 - Math.abs(i) * 0.03, 0.06, i * 0.016,
      mix(pal.mid, pal.bright, 0.3), mix(pal.mid, pal.bright, 0.6), ash ? 0.15 : 0.35);
  }

  // ---- Wings, built feather by feather: a smooth leading edge
  // out to a SHARP tip, then five primaries stepping back toward
  // the root, each a pointed leaf whose trailing edge scallops
  // inward to the next feather's base. The whole wing rides the
  // lift parameter: tip and outer feathers travel most, the root
  // stays planted on the body.
  const drawWing = (side: 1 | -1) => {
    const X = (nx: number) => px(side * nx * wingSpread);
    const tipZ = 0.27 - 0.15 * lift + sweep * 0.17;
    const lead = (nx: number, nz: number): [number, number] => [X(nx), py(nz)];
    // Primary feather tips, outermost first.
    const tips: Array<[number, number]> = [
      [0.99, tipZ],
      [0.875, tipZ + 0.088],
      [0.745, tipZ + 0.155],
      [0.60, tipZ + 0.212],
      [0.44, tipZ + 0.258],
      [0.27, tipZ + 0.29],
    ];
    if (skin.glyph.serrated) {
      for (let i = 1; i < tips.length; i++) tips[i] = [tips[i][0], tips[i][1] + (i % 2 === 0 ? 0.012 : -0.012)];
    }
    const rootTop: [number, number] = [0.05, 0.262];
    const rootBot: [number, number] = [0.075, 0.475];
    const wing = new Path2D();
    wing.moveTo(X(rootTop[0]), py(rootTop[1]));
    // Leading edge: two smooth spans out to the tip, kept sharp at
    // the tip itself (lineTo, no rounding through it).
    wing.quadraticCurveTo(X(0.30), py(0.222 - 0.05 * lift + sweep * 0.05), X(0.58), py(0.212 - 0.10 * lift + sweep * 0.10));
    wing.lineTo(X(tips[0][0]), py(tips[0][1]));
    // Trailing edge: from each feather tip, a concave scallop into
    // the next feather's base, the base sitting up and inward.
    for (let f = 0; f < tips.length; f++) {
      const [tx2, tz2] = tips[f];
      const next = f + 1 < tips.length ? tips[f + 1] : [rootBot[0] + 0.05, rootBot[1] - 0.01];
      const baseX = tx2 - (tx2 - next[0]) * 0.30;
      const baseZ = tz2 + (next[1] - tz2) * 0.30 - 0.045;
      wing.quadraticCurveTo(X(baseX), py(baseZ), X(next[0]), py(next[1]));
      if (f + 1 < tips.length) {
        const [nx2, nz2] = tips[f + 1];
        wing.quadraticCurveTo(X(nx2 + (baseX - nx2) * 0.25), py(nz2 - 0.028), X(nx2), py(nz2));
      }
    }
    wing.lineTo(X(rootBot[0]), py(rootBot[1]));
    wing.closePath();
    const wg = ctx.createLinearGradient(px(0), 0, X(0.99), 0);
    wg.addColorStop(0, css(mix(pal.bright, pal.mid, 0.45)));
    wg.addColorStop(0.5, css(pal.mid));
    wg.addColorStop(1, css(pal.deep));
    ctx.save();
    if (!ash) {
      ctx.shadowColor = css(pal.mid, 0.5);
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = wg;
    ctx.fill(wing);
    ctx.restore();
    // Bright leading-edge band, clipped to the wing.
    ctx.save();
    ctx.clip(wing);
    const lg = ctx.createLinearGradient(0, py(0.16), 0, py(0.42));
    lg.addColorStop(0, css(pal.bright, ash ? 0.25 : 0.55));
    lg.addColorStop(1, css(pal.bright, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H * 0.55);
    // Feather separation strokes, root fan to each scallop valley.
    ctx.strokeStyle = css(pal.deep, 0.55);
    ctx.lineWidth = 4;
    for (let f = 1; f < tips.length; f++) {
      const [tx2, tz2] = tips[f];
      ctx.beginPath();
      ctx.moveTo(X(0.16 + f * 0.055), py(0.30 + f * 0.012));
      ctx.quadraticCurveTo(X(tx2 * 0.72), py(tz2 - 0.055), X(tx2 - 0.045), py(tz2 - 0.035));
      ctx.stroke();
    }
    ctx.restore();
    // Covert layer: a smaller inner wing over the root, dimmer than
    // the primaries so the wing reads layered, not solid.
    const covert = new Path2D();
    covert.moveTo(X(0.055), py(0.272));
    covert.quadraticCurveTo(X(0.30), py(0.245 - 0.05 * lift + sweep * 0.05), X(0.52), py(0.265 - 0.075 * lift + sweep * 0.08));
    covert.quadraticCurveTo(X(0.40), py(tipZ + 0.20), X(0.20), py(0.465));
    covert.lineTo(X(0.085), py(0.44));
    covert.closePath();
    ctx.fillStyle = css(mix(pal.bright, pal.mid, 0.35), 0.5);
    ctx.fill(covert);
    ctx.strokeStyle = css(pal.bright, skin.glyph.darkHeart ? 0.9 : 0.38);
    ctx.lineWidth = 4;
    ctx.stroke(wing);
  };
  drawWing(-1);
  drawWing(1);

  // ---- Body: head, pinched neck, bright breast, tapering to the
  // tail root. Mirrored smooth path, bright-core gradient (mid
  // dominant, deep only at the rim).
  const smoothPath = (pts: Array<[number, number]>) => {
    const path = new Path2D();
    if (skin.glyph.angular) {
      pts.forEach(([x, y], i) => { if (i === 0) path.moveTo(x, y); else path.lineTo(x, y); });
    } else {
      const n = pts.length;
      path.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
      for (let i = 0; i < n; i++) {
        const [x, y] = pts[i];
        const [mx, my] = pts[(i + 1) % n];
        path.quadraticCurveTo(x, y, (x + mx) / 2, (y + my) / 2);
      }
    }
    path.closePath();
    return path;
  };
  const bodyPts: Array<[number, number]> = [
    [px(0), py(0.016)],
    [px(0.064), py(0.042)],
    [px(0.092), py(0.102)],
    [px(0.072), py(0.152)],
    [px(0.050), py(0.182)],
    [px(0.088), py(0.258)],
    [px(0.110), py(0.335)],
    [px(0.098), py(0.43)],
    [px(0.064), py(0.53)],
    [px(0.034), py(0.605)],
    [px(0), py(0.625)],
    [px(-0.034), py(0.605)],
    [px(-0.064), py(0.53)],
    [px(-0.098), py(0.43)],
    [px(-0.110), py(0.335)],
    [px(-0.088), py(0.258)],
    [px(-0.050), py(0.182)],
    [px(-0.072), py(0.152)],
    [px(-0.092), py(0.102)],
    [px(-0.064), py(0.042)],
  ];
  const body = smoothPath(bodyPts);
  const grad = ctx.createRadialGradient(px(0), py(0.30), 8, px(0), py(0.36), H * 0.52);
  grad.addColorStop(0, css(pal.bright));
  grad.addColorStop(0.42, css(pal.mid));
  grad.addColorStop(1, css(pal.deep));
  ctx.save();
  if (!ash) {
    ctx.shadowColor = css(pal.mid, 0.75);
    ctx.shadowBlur = 20;
  }
  ctx.fillStyle = grad;
  ctx.fill(body);
  ctx.restore();

  ctx.save();
  ctx.clip(body);
  // Head bead: a soft bright highlight on the head so the front of
  // the bird locks on as a head at gameplay size.
  const hg = ctx.createRadialGradient(px(0), py(0.10), 4, px(0), py(0.10), 80);
  hg.addColorStop(0, 'rgba(255,255,255,0.42)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, H);
  // Breast bead: the brightest point of the body sits on the chest.
  const bg2 = ctx.createRadialGradient(px(0), py(0.30), 4, px(0), py(0.30), 110);
  bg2.addColorStop(0, 'rgba(255,255,255,0.22)');
  bg2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bg2;
  ctx.fillRect(0, 0, W, H);
  if (!ash && skin.glyph.darkHeart) {
    const dg = ctx.createRadialGradient(px(0), py(0.32), 10, px(0), py(0.32), W * 0.30);
    dg.addColorStop(0, 'rgba(10,4,24,0.88)');
    dg.addColorStop(1, 'rgba(10,4,24,0)');
    ctx.fillStyle = dg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = css(pal.bright, 0.95);
    ctx.beginPath(); ctx.arc(px(0), py(0.25), 14, 0, Math.PI * 2); ctx.fill();
  }
  if (!ash && skin.glyph.facets) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(W * (0.15 + i * 0.11), H * 0.06);
      ctx.lineTo(W * (0.30 + i * 0.09), H * 0.44);
      ctx.stroke();
    }
  }
  if (!ash && skin.glyph.sparkles) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 26; i++) {
      const x = W * (0.2 + rnd() * 0.6), y = H * (0.08 + rnd() * 0.84), r = 3 + rnd() * 5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  ctx.strokeStyle = css(pal.bright, skin.glyph.darkHeart ? 0.95 : 0.45);
  ctx.lineWidth = 4.5;
  ctx.stroke(body);

  // ---- Head details: beak wedge (plus a darker hook under it),
  // eyes, and the per-skin crest, all carried from the glyph's
  // treatments at the higher resolution.
  const brightCss = css(pal.bright);
  ctx.fillStyle = brightCss;
  ctx.beginPath();
  ctx.moveTo(px(-0.056), py(0.052)); ctx.lineTo(px(0), py(-0.014)); ctx.lineTo(px(0.056), py(0.052));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(pal.deep, 0.9);
  ctx.beginPath();
  ctx.moveTo(px(-0.034), py(0.058)); ctx.lineTo(px(0), py(0.016)); ctx.lineTo(px(0.034), py(0.058));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = skin.glyph.darkHeart && !ash ? 'rgba(240,235,255,0.92)' : 'rgba(26,10,6,0.85)';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.arc(px(0.050 * side), py(0.098), 9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = brightCss;
  const hx = px(0), hy = py(0.098);
  const spike = (dx: number, len: number, w: number, splay: number) => {
    ctx.beginPath();
    ctx.moveTo(hx + dx - w, hy - 6); ctx.lineTo(hx + dx + splay, hy + len); ctx.lineTo(hx + dx + w, hy - 6);
    ctx.closePath(); ctx.fill();
  };
  const crownTri = (dx: number, h: number, w: number) => {
    ctx.beginPath();
    ctx.moveTo(hx + dx - w, hy + 6); ctx.lineTo(hx + dx, hy - h); ctx.lineTo(hx + dx + w, hy + 6);
    ctx.closePath(); ctx.fill();
  };
  if (skin.glyph.crest === 'tuft') {
    ctx.beginPath(); ctx.arc(hx, hy - 9, 13, 0, Math.PI * 2); ctx.fill();
    spike(-18, 33, 10, -9); spike(18, 33, 10, 9);
  } else if (skin.glyph.crest === 'spikes') { spike(-24, 60, 9, -15); spike(0, 72, 9, 0); spike(24, 60, 9, 15); }
  else if (skin.glyph.crest === 'rays') { for (let i = -2; i <= 2; i++) spike(i * 21, 69 - Math.abs(i) * 9, 8, i * 12); }
  else if (skin.glyph.crest === 'crown') { crownTri(-24, 39, 12); crownTri(0, 54, 12); crownTri(24, 39, 12); }
  else if (skin.glyph.crest === 'swept') {
    spike(0, 45, 9, 0);
    ctx.beginPath(); ctx.moveTo(hx - 6, hy - 6); ctx.lineTo(hx - 81, hy + 57); ctx.lineTo(hx - 15, hy + 18); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx + 6, hy - 6); ctx.lineTo(hx + 81, hy + 57); ctx.lineTo(hx + 15, hy + 18); ctx.closePath(); ctx.fill();
  } else if (skin.glyph.crest === 'leaf') {
    ctx.beginPath(); ctx.ellipse(hx, hy + 27, 13, 33, 0.15, 0, Math.PI * 2); ctx.fill();
  }
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function buildSet(skin: PhoenixSkin, pal: { bright: Rgb3; mid: Rgb3; deep: Rgb3 }, ash: boolean): { frames: THREE.CanvasTexture[]; drill: THREE.CanvasTexture } {
  const frames: THREE.CanvasTexture[] = [];
  for (let i = 0; i < PHOENIX_FLAP_FRAMES; i++) {
    const phase = i / PHOENIX_FLAP_FRAMES;
    const lift = Math.sin(phase * Math.PI * 2);
    frames.push(toTexture(drawPhoenixFrame(skin, pal, lift, 0, ash)));
  }
  const drill = toTexture(drawPhoenixFrame(skin, pal, -0.85, 1, ash));
  return { frames, drill };
}

// The full frame set for a skin, cached: the living set is built on
// first use; the ash set is built lazily the first time a death or
// rebirth sequence asks for it (see ensureAshFrames), so menu load
// only pays for the living bird.
export function getPhoenixFrames(skin: PhoenixSkin): PhoenixFrameSet {
  let set = frameCache.get(skin.id);
  if (!set) {
    const living = buildSet(skin, skin, false);
    set = { frames: living.frames, drill: living.drill, ashFrames: [], ashDrill: living.drill };
    frameCache.set(skin.id, set);
  }
  return set;
}

export function ensureAshFrames(skin: PhoenixSkin): PhoenixFrameSet {
  const set = getPhoenixFrames(skin);
  if (set.ashFrames.length === 0) {
    const ash = buildSet(skin, ASH_PALETTE, true);
    set.ashFrames = ash.frames;
    set.ashDrill = ash.drill;
  }
  return set;
}

// Flap frame for a bird's accumulated flapTime. The old formation's
// wing offset was sin(flapTime), one full flap per 2 pi of flapTime;
// the sprite cycles its pre-rendered frames on the same phase so the
// flap cadence (menu 0.6x, cruise 1x, climb burst 1.6x through
// flapRate) is unchanged.
export function flapFrameIndex(flapTime: number): number {
  const phase = ((flapTime / (Math.PI * 2)) % 1 + 1) % 1;
  return Math.floor(phase * PHOENIX_FLAP_FRAMES) % PHOENIX_FLAP_FRAMES;
}

export function flapLift(flapTime: number): number {
  return Math.sin(flapTime);
}
