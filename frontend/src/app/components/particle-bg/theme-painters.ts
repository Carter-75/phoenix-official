// World backdrop painters: each world paints its far silhouette,
// mid silhouette, and ground strip onto canvases that the component
// composites into a single backdrop texture (the composited-plane
// approach measured in Stage 6). Pure canvas work: the painters take
// a 2D context, a size, and the WorldTheme record, and hold no state.
// Moved out of particle-bg.component.ts in the code organization
// pass (Oct 27, 2026); paint code unchanged.
import * as THREE from 'three';
import { WorldTheme } from '../../models/game.models';
import { Rgb3 } from './phoenix-skins';

export function makeLayerTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(makeLayerCanvas(w, h, paint));
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

export function makeLayerCanvas(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    paint(ctx, w, h);
    return canvas;
  }

  // Composites a world's whole backdrop into one canvas: a deep
  // vertical gradient from the palette, the sky glows baked with
  // additive compositing (the secondary glow included for World 3),
  // the far silhouette layer, the mid silhouette layer, and the
  // ground strip drawn at the v-band whose projection matches the
  // shipped ground line (its top edge about 85 percent down the
  // field; the strip keeps its own painted gradient and features).
export function makeBackdropCanvas(painters: any, td: any): HTMLCanvasElement {
    const W = 1024, H = 512;
    const farC = makeLayerCanvas(W, H, (c, w, h) => painters.far(c, w, h, td));
    const midC = makeLayerCanvas(W, H, (c, w, h) => painters.mid(c, w, h, td));
    const gndC = makeLayerCanvas(W, 128, (c, w, h) => painters.ground(c, w, h, td));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, silColor(td.palette.deep, 0.30));
    grad.addColorStop(0.55, silColor(td.palette.deep, 0.13));
    grad.addColorStop(1, silColor(td.palette.deep, 0.20));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const bakeGlow = (cx: number, cy: number, r: number, rgb: any, alpha: number) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const lin = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 2.2));
      // Feathered falloff (Carter, Oct 28): the old two-stop
      // linear ramp met the dark sky at a constant slope, so the
      // disc's rim read as a hard ring wherever the scrolling
      // backdrop wrapped it across a screen edge. The alpha now
      // follows a smoothstep decay sampled into stops: same peak
      // alpha, same midpoint, same total baked energy, but it
      // approaches zero tangentially, so the disc reads as soft
      // glow with no rim band at any scroll phase. Shared by
      // every world's bake, with colors, placement, radius, and
      // intensity untouched.
      const col = `${lin(rgb[0])},${lin(rgb[1])},${lin(rgb[2])}`;
      const STOPS = 10;
      for (let i = 0; i <= STOPS; i++) {
        const t = i / STOPS;
        const s = t * t * (3 - 2 * t);
        g.addColorStop(t, `rgba(${col},${+(alpha * (1 - s)).toFixed(4)})`);
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    // Glow placement from the sheet's sky position. Golden Sands
    // (Stage 8) is the one off-center sky: a huge low sun baked
    // at the bottom-left corner. Blood Moon's glow rides high.
    // Abyssal Rift's primary light is the seam, which lives on
    // its own planes (applyThemeScene), so its backdrop takes
    // only the dim violet ambience of the secondary glow below.
    const gy = td.sky.position === 'low' ? H * 1.02 : td.sky.position === 'top' ? -H * 0.02
      : td.sky.position === 'high' ? H * 0.06 : td.sky.position === 'corner' ? H * 1.04 : H * 0.5;
    const gx = td.sky.position === 'corner' ? W * 0.08 : W / 2;
    const gr = td.sky.position === 'corner' ? W * 0.62 : W * 0.55;
    const ga = td.sky.position === 'off-center vertical rift' ? 0 : 0.15 * td.sky.intensity;
    bakeGlow(gx, gy, gr, td.sky.glow, ga);
    // The Rift's secondary wash is dimmer than the standard
    // bake: at 0.13 the broad violet glow kept World 10 within
    // noise of Blood Moon's menu luminance, and the sheet
    // calls the Rift the darkest world in the game (Stage 8
    // menu census, runs B and C: 22.0/22.7 then 22.4/22.0).
    const secAlpha = td.sky.position === 'off-center vertical rift' ? 0.07 : 0.13;
    if (td.sky.secondaryGlow) bakeGlow(W * 0.68, H * 0.30, W * 0.34, td.sky.secondaryGlow, secAlpha);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(farC, 0, 0);
    ctx.drawImage(midC, 0, 0);
    ctx.drawImage(gndC, 0, H * 0.59, W, H * 0.13);
    return canvas;
  }

export function makeBackdropTexture(painters: any, td: any): THREE.CanvasTexture {
    const canvas = makeBackdropCanvas(painters, td);
    // No sRGB texture format here on purpose: the harness's
    // software renderer pays a per-texel decode for sRGB sampling
    // (measured about +20 ms per frame), while real GPUs decode in
    // hardware for free. The painted colors are pre-linearized in
    // silColor and bakeGlow instead, which produces the same image
    // through the default (linear) texture path every other canvas
    // texture in the game already uses.
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  // The scrolling variant (World 1 Finish): the authored backdrop
  // does not tile vertically (silhouettes anchor at the bottom, the
  // upper field is smooth sky), so a plain repeat would show a hard
  // junction where the image's bottom row meets its top row. This
  // builder shifts the composited canvas down by half a tile, which
  // moves that junction to the middle of the texture, then
  // crossfades a band around it toward the unshifted image, whose
  // rows there are the backdrop's own smooth mid field. The result
  // is periodic by construction: its top and bottom rows are
  // adjacent rows of the original, and the only remaining junction
  // sits inside the crossfade band, dissolved. Same texture path
  // and the same single composited plane as the static variant;
  // only wrapT changes to Repeat so the component can scroll it.
export function makeScrollBackdropTexture(painters: any, td: any): THREE.CanvasTexture {
    const img = makeBackdropCanvas(painters, td);
    const W = img.width, H = img.height, HALF = H / 2, BAND = 56;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(img, 0, HALF);
    ctx.drawImage(img, 0, HALF - H);
    // The crossfade strip: the unshifted image's rows across the
    // seam, masked by a tent gradient (transparent at the band
    // edges, opaque at the seam) so the blend itself is invisible.
    const strip = document.createElement('canvas');
    strip.width = W; strip.height = BAND * 2;
    const sctx = strip.getContext('2d')!;
    sctx.drawImage(img, 0, HALF - BAND, W, BAND * 2, 0, 0, W, BAND * 2);
    sctx.globalCompositeOperation = 'destination-in';
    const mask = sctx.createLinearGradient(0, 0, 0, BAND * 2);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(0.5, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = mask;
    sctx.fillRect(0, 0, W, BAND * 2);
    ctx.drawImage(strip, 0, HALF - BAND);
    const tex = new THREE.CanvasTexture(out);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Side wall painters (World 1 Finish), dispatched by the wall
  // key in the world's scroll record. A wall painter draws one
  // vertical strip: canvas x = 0 is the wall face line (the
  // innermost extent of the art, where the bird's flight clamps),
  // x = w is the outer edge past the screen edge. Everything is
  // drawn with vertical wrap copies, so the strip tiles in Y by
  // construction. Only World 1 has a painter in this pass; the
  // other worlds' keys are reserved in their data records.
export function wallPainters(worldIndex: number) {
    switch (worldIndex) {
      case 0: return paintEmberWall;
      default: return null;
    }
  }

  // Draws the same shapes at y offsets -h, 0, +h so a wall strip
  // wraps seamlessly in the vertical direction.
function vtiled(ctx: CanvasRenderingContext2D, h: number, draw: () => void) {
    for (const oy of [-h, 0, h]) {
      ctx.save();
      ctx.translate(0, oy);
      draw();
      ctx.restore();
    }
  }

  // World 1 wall, Ember Wastes: basalt rock and spike formations.
  // The rock mass runs from a jagged profile (about 30 percent
  // across the strip) to the outer edge; basalt spikes jut from
  // the profile toward the face line, their tips just reaching
  // it, so no art ever extends past the line the bird clamps at.
  // Rim light in the palette's bright orange traces the profile
  // and the spike edges; lava cracks glow inside the rock mass.
export function paintEmberWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(1501);
    const P = td.palette;
    // Rock mass base: dark basalt, slightly lighter near the
    // face where the world's glow catches it, darker outward.
    const base = ctx.createLinearGradient(0, 0, w, 0);
    base.addColorStop(0, silColor(P.deep, 0.72));
    base.addColorStop(0.3, silColor(P.deep, 0.58));
    base.addColorStop(1, silColor(P.deep, 0.34));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // The jagged profile: a sum of whole-period sines, so the
    // profile (and everything anchored to it: the cut, the rim,
    // the wash, the spikes) is periodic in y by construction and
    // the strip wraps with no jump at the seam. The rim and the
    // spike anchors all share this one shape.
    const ph1 = rnd() * Math.PI * 2, ph2 = rnd() * Math.PI * 2, ph3 = rnd() * Math.PI * 2;
    const profileX = (y: number) => w * 0.31
      + Math.sin((y / h) * Math.PI * 2 * 2 + ph1) * w * 0.045
      + Math.sin((y / h) * Math.PI * 2 * 3 + ph2) * w * 0.030
      + Math.sin((y / h) * Math.PI * 2 * 5 + ph3) * w * 0.018;
    // Cut the channel side of the profile back to transparent:
    // the wall plane is transparent there, so the scrolling
    // backdrop shows through between the spike tips.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, -4);
    for (let y = -4; y <= h + 4; y += 16) ctx.lineTo(profileX(y), y);
    ctx.lineTo(0, h + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Clip the interior details to the rock side of the profile
    // so nothing floats in the transparent channel zone.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w + 4, -4);
    for (let y = -4; y <= h + 4; y += 16) ctx.lineTo(profileX(y), y);
    ctx.lineTo(w + 4, h + 4);
    ctx.closePath();
    ctx.clip();
    // The feature lists are generated ONCE and drawn identically
    // at every vertical wrap offset: a wrap copy that re-rolled
    // its own random features would not be a copy, and the strip
    // would jump at the seam wherever a feature crosses it.
    // Fractured basalt facets: angular plates in varied deep
    // shades, so the mass reads as broken rock, not a flat fill.
    const facets: { fx: number; fy: number; fw: number; fh: number; shade: number; j: number[] }[] = [];
    for (let i = 0; i < 26; i++) {
      facets.push({
        fx: w * (0.30 + rnd() * 0.68), fy: rnd() * h,
        fw: w * (0.08 + rnd() * 0.20), fh: 26 + rnd() * 74,
        shade: 0.30 + rnd() * 0.38,
        j: [(rnd() - 0.5) * 8, 0.2 + rnd() * 0.3, 0.5 + rnd() * 0.4, 0.1 + rnd() * 0.3, 0.6 + rnd() * 0.3]
      });
    }
    // Inset boulders with a lit lower rim.
    const boulders: { bx: number; by: number; bw: number; bh: number }[] = [];
    for (let i = 0; i < 7; i++) {
      boulders.push({ bx: w * (0.38 + rnd() * 0.55), by: rnd() * h, bw: w * (0.10 + rnd() * 0.16), bh: 14 + rnd() * 30 });
    }
    // Lava cracks: short jagged segments inside the rock, thin
    // and sparse, each a brief split with a faint glow, never a
    // continuous river.
    const cracks: { pts: [number, number][] }[] = [];
    for (let i = 0; i < 9; i++) {
      let cxp = w * (0.42 + rnd() * 0.50), cyp = rnd() * h;
      const segs = 3 + Math.floor(rnd() * 3);
      const pts: [number, number][] = [[cxp, cyp]];
      for (let s = 0; s < segs; s++) {
        cxp += (rnd() - 0.5) * w * 0.10;
        cyp += 18 + rnd() * 30;
        pts.push([cxp, cyp]);
      }
      cracks.push({ pts });
    }
    vtiled(ctx, h, () => {
      for (const f of facets) {
        ctx.fillStyle = silColor(P.deep, f.shade, 0.85);
        ctx.beginPath();
        ctx.moveTo(f.fx + f.j[0], f.fy);
        ctx.lineTo(f.fx + f.fw, f.fy + f.fh * f.j[1]);
        ctx.lineTo(f.fx + f.fw * f.j[2], f.fy + f.fh);
        ctx.lineTo(f.fx - f.fw * f.j[3], f.fy + f.fh * f.j[4]);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = silColor(P.bright, 0.5, 0.16);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      for (const b of boulders) {
        ctx.fillStyle = silColor(P.deep, 0.30, 0.55);
        ctx.beginPath();
        ctx.ellipse(b.bx, b.by, b.bw, b.bh, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = silColor(P.bright, 0.55, 0.35);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(b.bx, b.by, b.bw, b.bh, 0, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      ctx.save();
      ctx.shadowColor = silColor(P.mid, 1.0);
      ctx.shadowBlur = 5;
      ctx.strokeStyle = silColor(P.mid, 0.9, 0.7);
      ctx.lineWidth = 1.6;
      for (const c of cracks) {
        ctx.beginPath();
        ctx.moveTo(c.pts[0][0], c.pts[0][1]);
        for (let s = 1; s < c.pts.length; s++) ctx.lineTo(c.pts[s][0], c.pts[s][1]);
        ctx.stroke();
      }
      ctx.restore();
    });
    // A soft wash of the world's glow along the profile, inside
    // the rock, so the face reads lit rather than cut out.
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = silColor(P.mid, 0.8);
    ctx.beginPath();
    ctx.moveTo(w + 4, -4);
    for (let y = -4; y <= h + 4; y += 16) ctx.lineTo(profileX(y), y);
    for (let y = h + 4; y >= -4; y -= 16) ctx.lineTo(profileX(y) + w * 0.16, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore(); // the rock-side clip
    // Spikes: basalt shards anchored on the profile, tips toward
    // the face line. Drawn after the cut so their bases sit in
    // the rock; a spike never crosses x = 2. Same
    // generate-once rule as the interior features.
    const spikes: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const sy = rnd() * h;
      const anchor = profileX(sy);
      spikes.push({ sy, anchor, len: anchor - 4 - rnd() * w * 0.06, halfBase: 9 + rnd() * 13, tipDy: (rnd() - 0.5) * 8 });
    }
    vtiled(ctx, h, () => {
      for (const s of spikes) {
        ctx.fillStyle = silColor(P.deep, 0.62);
        ctx.beginPath();
        ctx.moveTo(s.anchor + w * 0.05, s.sy - s.halfBase);
        ctx.lineTo(s.anchor - s.len, s.sy + s.tipDy);
        ctx.lineTo(s.anchor + w * 0.05, s.sy + s.halfBase);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = silColor(P.bright, 0.85, 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.anchor + w * 0.05, s.sy - s.halfBase);
        ctx.lineTo(s.anchor - s.len, s.sy);
        ctx.stroke();
      }
    });
    // The rim light along the profile itself.
    ctx.strokeStyle = silColor(P.bright, 0.9, 0.6);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let y = -4; y <= h + 4; y += 16) {
      const x = profileX(y);
      if (y === -4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = silColor(P.mid, 0.9, 0.30);
    ctx.lineWidth = 8;
    ctx.stroke();
  }

  // Deterministic per-layer random source, so a world's silhouettes
  // are the same every visit (and identical in the harness).
function themeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Backdrop paint color: the palette values are authored as sRGB,
  // but the backdrop texture renders through the default linear
  // path (see makeBackdropTexture), which brightens bytes on
  // output. Pre-linearizing each channel (gamma 2.2) makes the
  // rendered color match the authored one.
export function silColor(rgb: Rgb3, f: number, a = 1): string {
    const lin = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v * f)), 2.2));
    return `rgba(${lin(rgb[0])},${lin(rgb[1])},${lin(rgb[2])},${a})`;
  }

  // Draws the same shapes at x offsets -w, 0, +w so the repeating
  // texture wraps seamlessly.
function tiled(ctx: CanvasRenderingContext2D, w: number, draw: () => void) {
    for (const ox of [-w, 0, w]) {
      ctx.save();
      ctx.translate(ox, 0);
      draw();
      ctx.restore();
    }
  }

export function themePainters(worldIndex: number) {
    switch (worldIndex) {
      case 0: return { far: paintEmberFar, mid: paintEmberMid, ground: paintGroundLava };
      case 1: return { far: paintDepthsFar, mid: paintDepthsMid, ground: paintGroundVents };
      case 2: return { far: paintVoidFar, mid: paintVoidMid, ground: paintGroundMirror };
      case 3: return { far: paintCanopyFar, mid: paintCanopyMid, ground: paintGroundForest };
      case 4: return { far: paintAshenFar, mid: paintAshenMid, ground: paintGroundAshRidge };
      case 5: return { far: paintCavernFar, mid: paintCavernMid, ground: paintGroundCrystal };
      case 6: return { far: paintNebulaFar, mid: paintNebulaMid, ground: paintGroundIce };
      case 7: return { far: paintSandsFar, mid: paintSandsMid, ground: paintGroundDune };
      case 8: return { far: paintBloodFar, mid: paintBloodMid, ground: paintGroundBloodRidge };
      case 9: return { far: paintRiftFar, mid: paintRiftMid, ground: paintGroundNone };
      default: return null;
    }
  }

  // World 1 far: black basalt spires and broken arches.
function paintEmberFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(101);
    const fill = silColor(td.palette.deep, 0.32);
    const base = h * 0.99;
    ctx.fillStyle = fill;
    tiled(ctx, w, () => {
      let x = -20;
      while (x < w * 0.7) {
        const sw = 14 + rnd() * 32;
        const sh = h * (0.16 + rnd() * 0.20);
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + sw * 0.18, base - sh * 0.82);
        ctx.lineTo(x + sw * (0.38 + rnd() * 0.2), base - sh);
        ctx.lineTo(x + sw * (0.66 + rnd() * 0.16), base - sh * 0.78);
        ctx.lineTo(x + sw, base);
        ctx.closePath(); ctx.fill();
        x += sw + 6 + rnd() * 30;
      }
      // Broken arches: two pillars and a half-ring band, the opening
      // left transparent so the sky glow shows through the ruin.
      for (let k = 0; k < 2; k++) {
        const ax = w * (0.24 + 0.44 * k) + rnd() * 40;
        const aw = 84 + rnd() * 40, ah = h * (0.30 + rnd() * 0.10), pw = 16;
        ctx.fillRect(ax, base - ah, pw, ah);
        ctx.fillRect(ax + aw - pw, base - ah, pw, ah);
        ctx.beginPath();
        ctx.arc(ax + aw / 2, base - ah + pw, aw / 2 - pw / 2, Math.PI, 0);
        ctx.lineWidth = pw;
        ctx.strokeStyle = fill;
        ctx.stroke();
      }
    });
  }

  // World 1 mid: drifting slag boulders, rim-lit orange from below.
function paintEmberMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(102);
    const fill = silColor(td.palette.deep, 0.45);
    tiled(ctx, w, () => {
      for (let k = 0; k < 12; k++) {
        const cx = rnd() * w, cy = h * (0.68 + rnd() * 0.26);
        const rx = 16 + rnd() * 26, ry = rx * (0.45 + rnd() * 0.2);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        // Rim light, feathered (Carter, Oct 28): the single hard
        // 3 px stroke read as a stray gold ring segment once the
        // scrolling backdrop magnified a boulder across the
        // screen (the arc in the texture analysis,
        // backdrop-boulder-rims-hard.png). The same bottom arc
        // is now laid in three passes, wide and faint to narrow
        // and strongest, so the light diffuses off the rim like
        // glow instead of ending at a drawn line. Same arc, same
        // bright palette color, softer edge.
        for (const pass of [[10, 0.08], [6, 0.14], [3, 0.22]] as const) {
          ctx.strokeStyle = silColor(td.palette.bright, 1.0, pass[1]);
          ctx.lineWidth = pass[0];
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
        }
      }
    });
  }

  // World 2 far: sunken pillars and a ruined gate.
function paintDepthsFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(201);
    const fill = silColor(td.palette.deep, 0.36);
    const base = h * 0.99;
    ctx.fillStyle = fill;
    tiled(ctx, w, () => {
      let x = 10;
      while (x < w * 0.75) {
        const pw = 20 + rnd() * 20;
        const broken = rnd() < 0.3;
        const top = broken ? h * (0.52 + rnd() * 0.14) : h * (0.34 + rnd() * 0.18);
        ctx.fillRect(x, top, pw, base - top);
        ctx.fillRect(x - 5, top - 11, pw + 10, 11); // capital
        x += pw + 44 + rnd() * 90;
      }
      // The ruined gate: two tall pillars and a lintel.
      const gx = w * 0.55, gw = 130, gt = h * 0.30;
      ctx.fillRect(gx, gt + 30, 34, base - gt - 30);
      ctx.fillRect(gx + gw - 34, gt + 44, 34, base - gt - 44);
      ctx.fillRect(gx - 12, gt, gw + 24, 26);
    });
  }

  // World 2 mid: slow jellyfish silhouettes drifting up.
function paintDepthsMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(202);
    const fill = silColor(td.palette.deep, 0.45, 0.9);
    tiled(ctx, w, () => {
      for (let k = 0; k < 10; k++) {
        const cx = rnd() * w, cy = h * (0.10 + rnd() * 0.48);
        const r = 11 + rnd() * 15;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.72, 0, Math.PI, Math.PI * 2);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = fill; ctx.lineWidth = 4;
        for (let j = -1; j <= 1; j++) {
          ctx.beginPath();
          const sx = cx + j * r * 0.42;
          ctx.moveTo(sx, cy + 2);
          ctx.quadraticCurveTo(sx + 7, cy + r * 0.9, sx - 4, cy + r * 1.7);
          ctx.stroke();
        }
      }
    });
  }

  // World 3 far: giant floating crystal shards, slowly rotating in
  // the sheet (the layer drift and counter-shift carry the motion).
function paintVoidFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(301);
    const fill = silColor(td.palette.deep, 0.55);
    const facet = silColor(td.palette.mid, 1.0, 0.4);
    tiled(ctx, w, () => {
      for (let k = 0; k < 7; k++) {
        const cx = rnd() * w, cy = h * (0.2 + rnd() * 0.55);
        const L = 42 + rnd() * 54, Wd = 11 + rnd() * 13, a = (rnd() - 0.5) * 1.1;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = facet; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
        ctx.restore();
      }
    });
  }

  // World 3 mid: smaller shard clusters drifting past.
function paintVoidMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(302);
    const fill = silColor(td.palette.deep, 0.7);
    const facet = silColor(td.palette.mid, 1.0, 0.3);
    tiled(ctx, w, () => {
      for (let c = 0; c < 5; c++) {
        const ccx = rnd() * w, ccy = h * (0.15 + rnd() * 0.6);
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const cx = ccx + (rnd() - 0.5) * 100, cy = ccy + (rnd() - 0.5) * 70;
          const L = 16 + rnd() * 24, Wd = 6 + rnd() * 7, a = (rnd() - 0.5) * 1.4;
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = facet; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
          ctx.restore();
        }
      }
    });
  }

  // World 1 ground: a lava glow line with pulses traveling along it
  // (the render loop scrolls this texture slowly). The line is a sum
  // of whole-period sines so it wraps seamlessly.
function paintGroundLava(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const yAt = (x: number) => 30 + 7 * Math.sin((2 * Math.PI * 3 * x) / w) + 4 * Math.sin((2 * Math.PI * 7 * x) / w + 1.3);
    // Deep glow wash under the line.
    const grad = ctx.createLinearGradient(0, 24, 0, h);
    grad.addColorStop(0, silColor(td.palette.mid, 1.0, 0.13));
    grad.addColorStop(1, silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 24, w, h - 24);
    // Rock mass below the line.
    ctx.fillStyle = silColor(td.palette.deep, 0.22);
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The lava line itself, with a soft bloom.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.95);
    ctx.lineWidth = 4;
    ctx.shadowColor = silColor(td.palette.mid, 1.0, 0.9);
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Brighter pulses spaced along the line.
    for (let x = 40; x < w; x += 128) {
      const g = ctx.createRadialGradient(x, yAt(x), 1, x, yAt(x), 17);
      g.addColorStop(0, silColor(td.palette.bright, 1.0, 0.55));
      g.addColorStop(1, silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - 17, yAt(x) - 17, 34, 34);
    }
  }

  // World 2 ground: abyssal dark with faint blue vent glows.
function paintGroundVents(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(203);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, silColor(td.palette.deep, 0.05, 0));
    grad.addColorStop(0.35, silColor(td.palette.deep, 0.30));
    grad.addColorStop(1, silColor(td.palette.deep, 0.42));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) {
      const cx = rnd() * w, cy = 46 + rnd() * 54, r = 18 + rnd() * 30;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      g.addColorStop(0, silColor(td.palette.bright, 1.0, 0.16));
      g.addColorStop(1, silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = silColor(td.palette.bright, 1.0, 0.35);
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // World 3 ground: a fractured mirror plane, shimmer only.
function paintGroundMirror(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(303);
    ctx.fillStyle = silColor(td.palette.deep, 0.30);
    ctx.fillRect(0, 18, w, h - 18);
    // The horizon reflects the glow in one broken streak.
    const grad = ctx.createLinearGradient(0, 18, 0, 34);
    grad.addColorStop(0, silColor(td.palette.mid, 1.0, 0.16));
    grad.addColorStop(1, silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 18, w, 16);
    // Facet lines catching the mid color.
    ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.28);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 26; k++) {
      let x = rnd() * w, y = 22 + rnd() * 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        x += (rnd() - 0.5) * 90;
        y += (rnd() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ----------------------------------------------------------------
  // Stage 7 theme painters: Worlds 4 to 6, same composited-backdrop
  // contract as batch 1 (dark silhouettes against the baked glow,
  // deterministic per-layer seeds, tiled for the wrap).
  // ----------------------------------------------------------------

  // World 4 far: layered canopy silhouettes overhead with hanging
  // vines (Verdant Canopy sheet). The mass hangs from the top of
  // the frame; a broken tree line closes the bottom.
function paintCanopyFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(401);
    const fill = silColor(td.palette.deep, 0.36);
    ctx.fillStyle = fill;
    tiled(ctx, w, () => {
      // Canopy mass: overlapping leaf-clumps hanging from the top.
      let x = -30;
      while (x < w + 30) {
        const rx = 46 + rnd() * 70, ry = rx * (0.42 + rnd() * 0.2);
        const cy = -ry * (0.25 + rnd() * 0.45);
        ctx.beginPath(); ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        x += rx * (0.9 + rnd() * 0.5);
      }
      // Hanging vines: thin curved strands dropping from the mass.
      ctx.strokeStyle = fill; ctx.lineWidth = 3;
      for (let k = 0; k < 9; k++) {
        const vx = rnd() * w, len = h * (0.18 + rnd() * 0.24), sway = (rnd() - 0.5) * 26;
        ctx.beginPath();
        ctx.moveTo(vx, 0);
        ctx.quadraticCurveTo(vx + sway * 0.4, len * 0.55, vx + sway, len);
        ctx.stroke();
        // A leaf pair at the strand's end.
        ctx.beginPath(); ctx.ellipse(vx + sway, len, 7, 3.5, sway * 0.02, 0, Math.PI * 2); ctx.fill();
      }
      // Distant tree line at the base: trunks under a broken crown.
      const base = h * 0.99;
      let tx = 0;
      while (tx < w * 0.8) {
        const tw = 10 + rnd() * 14, th = h * (0.10 + rnd() * 0.12);
        ctx.fillRect(tx, base - th, tw, th);
        ctx.beginPath(); ctx.ellipse(tx + tw / 2, base - th, tw * (1.1 + rnd() * 0.7), h * 0.045, 0, 0, Math.PI * 2); ctx.fill();
        tx += tw + 60 + rnd() * 110;
      }
    });
  }

  // World 4 mid: god-ray shafts from the top glow, then giant leaves
  // drifting past, dark with one bright rim edge (sheet).
function paintCanopyMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(402);
    tiled(ctx, w, () => {
      // God rays: two or three soft wedges widening downward from
      // the top glow. Painted as translucent bright fills over the
      // dark base, so they read as light without additive planes.
      for (let k = 0; k < 3; k++) {
        const sx = w * (0.16 + 0.3 * k) + rnd() * 50, topW = 26 + rnd() * 30, botW = topW * (2.6 + rnd() * 0.8), drift = (rnd() - 0.5) * 60;
        ctx.fillStyle = silColor(td.palette.bright, 1.0, 0.075);
        ctx.beginPath();
        ctx.moveTo(sx - topW / 2, 0);
        ctx.lineTo(sx + topW / 2, 0);
        ctx.lineTo(sx + drift + botW / 2, h * 0.86);
        ctx.lineTo(sx + drift - botW / 2, h * 0.86);
        ctx.closePath(); ctx.fill();
      }
      // Giant leaves: a pointed ellipse, near-black green, with the
      // rim light on its upper edge only.
      for (let k = 0; k < 8; k++) {
        const cx = rnd() * w, cy = h * (0.16 + rnd() * 0.62);
        const L = 34 + rnd() * 40, Wd = L * (0.30 + rnd() * 0.1), a = (rnd() - 0.5) * 1.5;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = silColor(td.palette.deep, 0.55);
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.quadraticCurveTo(Wd, 0, 0, L); ctx.quadraticCurveTo(-Wd, 0, 0, -L); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = silColor(td.palette.bright, 1.0, 0.38); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.quadraticCurveTo(Wd, 0, 0, L); ctx.stroke();
        ctx.restore();
      }
    });
  }

  // World 4 ground: shadowed forest floor with light pools where
  // the shafts land (sheet).
function paintGroundForest(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(403);
    // Dark floor mass.
    const grad = ctx.createLinearGradient(0, 20, 0, h);
    grad.addColorStop(0, silColor(td.palette.deep, 0.30));
    grad.addColorStop(1, silColor(td.palette.deep, 0.48));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 20, w, h - 20);
    // Light pools: soft bright ellipses on the floor.
    for (let k = 0; k < 6; k++) {
      const cx = rnd() * w, cy = 44 + rnd() * 56, rx = 30 + rnd() * 46, ry = rx * 0.22;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      g.addColorStop(0, silColor(td.palette.bright, 1.0, 0.13));
      g.addColorStop(1, silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
      ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
      ctx.restore();
    }
    // Fern silhouettes along the floor line.
    ctx.strokeStyle = silColor(td.palette.deep, 0.6); ctx.lineWidth = 2.5;
    for (let k = 0; k < 14; k++) {
      const fx = rnd() * w, fy = 30 + rnd() * 40, s = 8 + rnd() * 12;
      for (let j = -2; j <= 2; j++) {
        ctx.beginPath();
        ctx.moveTo(fx, fy + 14);
        ctx.quadraticCurveTo(fx + j * s * 0.5, fy + 14 - s * 0.8, fx + j * s * 0.8, fy + 14 - s * (1 - Math.abs(j) * 0.18));
        ctx.stroke();
      }
    }
  }

  // World 5 far: jagged peak silhouettes in three gray layers
  // (Ashen Peaks sheet). This is the one desaturated world: the
  // palette is gray at the data level, and the layers separate by
  // value alone.
function paintAshenFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    // Each ridge is a sum of triangle waves with whole-number
    // periods across the texture width, so the ridge is periodic
    // and the wrap seam is invisible (the lava line's trick, with
    // triangles instead of sines for the jagged profile).
    const tri = (x: number, periods: number, phase: number) => {
      const t = ((x / w) * periods + phase) % 1;
      return Math.abs(t - 0.5) * 2; // 0 at the peak, 1 in the valley
    };
    const layers: Array<{ baseY: number; amp: number; f: number; p1: number; p2: number; ph: number }> = [
      { baseY: 0.60, amp: 0.17, f: 0.62, p1: 5, p2: 9, ph: 0.13 },
      { baseY: 0.74, amp: 0.20, f: 0.74, p1: 7, p2: 12, ph: 0.47 },
      { baseY: 0.88, amp: 0.22, f: 0.86, p1: 6, p2: 11, ph: 0.71 },
    ];
    for (const layer of layers) {
      const yAt = (x: number) => h * (layer.baseY - layer.amp * (1 - (0.6 * tri(x, layer.p1, layer.ph) + 0.4 * tri(x, layer.p2, layer.ph * 1.7))));
      ctx.fillStyle = silColor(td.palette.deep, layer.f);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, yAt(0));
      for (let x = 12; x <= w; x += 12) ctx.lineTo(x, yAt(x));
      ctx.lineTo(w, h);
      ctx.closePath(); ctx.fill();
    }
  }

  // World 5 mid: tumbling ash boulders, gray on gray, a dull rim on
  // the upper edge (the Ember boulders' shape language, desaturated).
function paintAshenMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(504);
    const fill = silColor(td.palette.deep, 0.62);
    const rim = silColor(td.palette.mid, 1.0, 0.30);
    tiled(ctx, w, () => {
      for (let k = 0; k < 11; k++) {
        const cx = rnd() * w, cy = h * (0.14 + rnd() * 0.6);
        const rx = 13 + rnd() * 24, ry = rx * (0.5 + rnd() * 0.25);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      }
    });
  }

  // World 5 ground: a snow-ash ridge line (sheet), pale and still:
  // the ridge gets a dim gray stroke and a faint wash, no pulses.
function paintGroundAshRidge(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const yAt = (x: number) => 28 + 6 * Math.sin((2 * Math.PI * 2 * x) / w + 0.6) + 3 * Math.sin((2 * Math.PI * 5 * x) / w);
    // Ash mass below the ridge.
    const grad = ctx.createLinearGradient(0, 22, 0, h);
    grad.addColorStop(0, silColor(td.palette.deep, 0.30));
    grad.addColorStop(1, silColor(td.palette.deep, 0.16));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The ridge line itself: ash-pale, no bloom.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.55);
    ctx.lineWidth = 3;
    ctx.stroke();
    // Settled drifts piled against the line.
    const rnd = themeRng(505);
    ctx.fillStyle = silColor(td.palette.mid, 1.0, 0.10);
    for (let k = 0; k < 8; k++) {
      const cx = rnd() * w, cy = yAt(cx) + 8 + rnd() * 22, rx = 22 + rnd() * 34;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // World 6 far: cathedral crystal formations (Crystal Caverns
  // sheet): tall grounded clusters at the base and a hanging vault
  // above, faceted edges catching the world's cyan.
function paintCavernFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(601);
    const fill = silColor(td.palette.deep, 0.40);
    const facet = silColor(td.palette.mid, 1.0, 0.35);
    const base = h * 0.99;
    const shard = (cx: number, cy: number, L: number, Wd: number, a: number, flip: boolean) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); if (flip) ctx.scale(1, -1);
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L * 0.28); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = facet; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
      ctx.restore();
    };
    tiled(ctx, w, () => {
      // Grounded cathedral clusters.
      for (let c = 0; c < 5; c++) {
        const ccx = rnd() * w;
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const L = h * (0.24 + rnd() * 0.26);
          shard(ccx + (rnd() - 0.5) * 90, base - L * 0.72, L, 13 + rnd() * 15, (rnd() - 0.5) * 0.35, false);
        }
      }
      // The hanging vault: shorter shards pointing down from the top.
      for (let k = 0; k < 6; k++) {
        const L = h * (0.10 + rnd() * 0.13);
        shard(rnd() * w, L * 0.7, L, 9 + rnd() * 10, (rnd() - 0.5) * 0.3, true);
      }
    });
  }

  // World 6 mid: hanging crystal clusters with light shafts falling
  // from them (sheet: shafts from the clusters above; the slow
  // pulse as the player passes is cosmetic and lives in the baked
  // glow, so it costs no per-frame work).
function paintCavernMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(602);
    const fill = silColor(td.palette.deep, 0.58);
    const facet = silColor(td.palette.mid, 1.0, 0.30);
    tiled(ctx, w, () => {
      for (let c = 0; c < 6; c++) {
        const ccx = rnd() * w;
        // The shaft under this cluster.
        const shaftW = 30 + rnd() * 36;
        ctx.fillStyle = silColor(td.palette.bright, 1.0, 0.055);
        ctx.beginPath();
        ctx.moveTo(ccx - shaftW * 0.3, 0);
        ctx.lineTo(ccx + shaftW * 0.3, 0);
        ctx.lineTo(ccx + shaftW * 0.75, h * 0.8);
        ctx.lineTo(ccx - shaftW * 0.75, h * 0.8);
        ctx.closePath(); ctx.fill();
        // The cluster itself: a fan of downward shards.
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const cx = ccx + (rnd() - 0.5) * 56, L = 20 + rnd() * 30, Wd = 6 + rnd() * 7, a = (rnd() - 0.5) * 0.5;
          ctx.save(); ctx.translate(cx, L * 0.55); ctx.rotate(a); ctx.scale(1, -1);
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.lineTo(0, L * 0.3); ctx.lineTo(-Wd, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = facet; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(Wd, 0); ctx.stroke();
          ctx.restore();
        }
      }
    });
  }

  // World 6 ground: a reflective crystal floor (sheet): a bright
  // horizon streak, facet lines, and dim mirrored glows below it.
function paintGroundCrystal(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(603);
    ctx.fillStyle = silColor(td.palette.deep, 0.34);
    ctx.fillRect(0, 18, w, h - 18);
    // Horizon streak: the floor reflecting the top glow.
    const grad = ctx.createLinearGradient(0, 18, 0, 40);
    grad.addColorStop(0, silColor(td.palette.mid, 1.0, 0.20));
    grad.addColorStop(1, silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 18, w, 22);
    // Mirrored glow pools, dimmer than any real light.
    for (let k = 0; k < 5; k++) {
      const cx = rnd() * w, cy = 52 + rnd() * 52, rx = 26 + rnd() * 40;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      g.addColorStop(0, silColor(td.palette.bright, 1.0, 0.08));
      g.addColorStop(1, silColor(td.palette.bright, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
    }
    // Facet lines.
    ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.30);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 22; k++) {
      let x = rnd() * w, y = 24 + rnd() * 64;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        x += (rnd() - 0.5) * 100;
        y += (rnd() - 0.5) * 22;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ----------------------------------------------------------------
  // Stage 8 theme painters: Worlds 7 to 10, same composited-
  // backdrop contract as batches 1 and 2 (dark silhouettes against
  // the baked glow, deterministic per-layer seeds, tiled for the
  // wrap). The two set pieces that cannot live in a static bake,
  // Blood Moon's waxing moon and the Rift's pulsing seam, are
  // separate small meshes managed in applyThemeScene.
  // ----------------------------------------------------------------

  // World 7 far: the aurora curtain across the top third (two
  // wavy ribbons, magenta and teal, baked soft over the sky
  // glows), nebula cloud silhouettes, and a ringed planet.
function paintNebulaFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(701);
    // Aurora ribbons: horizontal bands with a sine top edge and
    // a long vertical fade, so the curtain hangs and dissolves.
    const ribbon = (baseY: number, amp: number, periods: number, phase: number, rgb: Rgb3, alpha: number) => {
      const grad = ctx.createLinearGradient(0, baseY - 26, 0, baseY + h * 0.30);
      grad.addColorStop(0, silColor(rgb, 1.0, 0));
      grad.addColorStop(0.35, silColor(rgb, 1.0, alpha));
      grad.addColorStop(1, silColor(rgb, 1.0, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, baseY + h * 0.30);
      ctx.lineTo(0, baseY + amp * Math.sin(phase));
      for (let x = 16; x <= w; x += 16) ctx.lineTo(x, baseY + amp * Math.sin((2 * Math.PI * periods * x) / w + phase));
      ctx.lineTo(w, baseY + h * 0.30);
      ctx.closePath(); ctx.fill();
    };
    ribbon(h * 0.06, 13, 2, 0.7, td.sky.secondaryGlow ?? [0.0, 0.9, 0.8], 0.16); // teal curtain
    ribbon(h * 0.16, 17, 3, 2.4, td.palette.bright, 0.13); // magenta curtain behind it
    tiled(ctx, w, () => {
      // Nebula clouds: clusters of soft dark ellipses with a
      // faint magenta rim on the lit side.
      for (let c = 0; c < 6; c++) {
        const ccx = rnd() * w, ccy = h * (0.30 + rnd() * 0.5);
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const cx = ccx + (rnd() - 0.5) * 120, cy = ccy + (rnd() - 0.5) * 42;
          const rx = 34 + rnd() * 62, ry = rx * (0.30 + rnd() * 0.16);
          ctx.fillStyle = silColor(td.palette.deep, 0.42);
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.16);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.15, Math.PI * 1.75); ctx.stroke();
        }
      }
      // The ringed planet, high right: a dark disc with a pale
      // ice rim, crossed by its ring.
      const px = w * 0.78, py = h * 0.20, pr = 34;
      ctx.fillStyle = silColor(td.palette.deep, 0.60);
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = silColor([0.90, 0.97, 1.0], 1.0, 0.30);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, pr, Math.PI * 1.05, Math.PI * 1.65); ctx.stroke();
      ctx.strokeStyle = silColor([0.90, 0.97, 1.0], 1.0, 0.22);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(px, py, pr * 1.9, pr * 0.42, -0.32, 0, Math.PI * 2); ctx.stroke();
    });
  }

  // World 7 mid: ice asteroids, faceted and tumbling: angular
  // shards of dark magenta rock with ice-white facet lines.
function paintNebulaMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(702);
    const fill = silColor(td.palette.deep, 0.58);
    const facet = silColor([0.90, 0.97, 1.0], 1.0, 0.30);
    tiled(ctx, w, () => {
      for (let k = 0; k < 12; k++) {
        const cx = rnd() * w, cy = h * (0.12 + rnd() * 0.66);
        const R = 12 + rnd() * 26, rot = rnd() * Math.PI * 2;
        const verts = 5 + Math.floor(rnd() * 3);
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let vIdx = 0; vIdx < verts; vIdx++) {
          const a = rot + (vIdx / verts) * Math.PI * 2;
          const rr = R * (0.62 + rnd() * 0.5);
          const vx = cx + Math.cos(a) * rr, vy = cy + Math.sin(a) * rr * 0.78;
          if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath(); ctx.fill();
        // One or two facet lines from the center of the rock.
        ctx.strokeStyle = facet; ctx.lineWidth = 1.5;
        for (let f = 0; f < 2; f++) {
          const a = rot + rnd() * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.62);
          ctx.stroke();
        }
      }
    });
  }

  // World 7 ground: an ice plain horizon with the aurora
  // reflected in it: a two-tone streak (magenta, then teal),
  // crack lines in pale ice, and dim mirrored glow pools.
function paintGroundIce(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(703);
    ctx.fillStyle = silColor(td.palette.deep, 0.34);
    ctx.fillRect(0, 18, w, h - 18);
    // The aurora reflection: magenta wash on the left reach of
    // the strip, teal on the right, both fading down.
    const gradM = ctx.createLinearGradient(0, 18, 0, 44);
    gradM.addColorStop(0, silColor(td.palette.mid, 1.0, 0.15));
    gradM.addColorStop(1, silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = gradM;
    ctx.fillRect(0, 18, w * 0.55, 26);
    const teal = td.sky.secondaryGlow ?? [0.0, 0.9, 0.8];
    const gradT = ctx.createLinearGradient(0, 18, 0, 44);
    gradT.addColorStop(0, silColor(teal, 1.0, 0.13));
    gradT.addColorStop(1, silColor(teal, 1.0, 0));
    ctx.fillStyle = gradT;
    ctx.fillRect(w * 0.45, 18, w * 0.55, 26);
    // Mirrored glow pools.
    for (let k = 0; k < 5; k++) {
      const cx = rnd() * w, cy = 52 + rnd() * 52, rx = 26 + rnd() * 40;
      const rgb = k % 2 === 0 ? td.palette.bright : teal;
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      g.addColorStop(0, silColor(rgb, 1.0, 0.07));
      g.addColorStop(1, silColor(rgb, 1.0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
    }
    // Ice cracks: pale thin fractures.
    ctx.strokeStyle = silColor([0.90, 0.97, 1.0], 1.0, 0.26);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 22; k++) {
      let x = rnd() * w, y = 24 + rnd() * 64;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        x += (rnd() - 0.5) * 110;
        y += (rnd() - 0.5) * 18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // World 8 far: dunes in smooth layered ridges, obelisks, and
  // the broken colossus (Golden Sands sheet), all matte silhou-
  // ette against the corner sun's haze.
function paintSandsFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(801);
    // Two dune ridges behind everything: sine sums with whole-
    // number periods so the wrap seam is invisible (the Ashen
    // ridge trick, smoothed for sand).
    const dune = (baseY: number, amp: number, f: number, p1: number, p2: number, ph: number) => {
      const yAt = (x: number) => h * baseY + h * amp * (0.6 * Math.sin((2 * Math.PI * p1 * x) / w + ph) + 0.4 * Math.sin((2 * Math.PI * p2 * x) / w + ph * 1.7));
      ctx.fillStyle = silColor(td.palette.deep, f);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, yAt(0));
      for (let x = 12; x <= w; x += 12) ctx.lineTo(x, yAt(x));
      ctx.lineTo(w, h);
      ctx.closePath(); ctx.fill();
    };
    dune(0.66, 0.05, 0.42, 2, 5, 0.4);
    dune(0.80, 0.06, 0.58, 3, 7, 1.9);
    const fill = silColor(td.palette.deep, 0.66);
    const rim = silColor(td.palette.mid, 1.0, 0.22);
    tiled(ctx, w, () => {
      // Obelisks: tapered pillars with a pyramidion cap, some
      // standing on the far dune line, one snapped short.
      for (let k = 0; k < 4; k++) {
        const ox = rnd() * w, ow = 13 + rnd() * 10, oh = h * (0.20 + rnd() * 0.16), oy = h * 0.86;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(ox - ow * 0.62, oy);
        ctx.lineTo(ox - ow * 0.40, oy - oh);
        ctx.lineTo(ox + ow * 0.40, oy - oh);
        ctx.lineTo(ox + ow * 0.62, oy);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(ox - ow * 0.52, oy - oh);
        ctx.lineTo(ox, oy - oh - ow * 0.72);
        ctx.lineTo(ox + ow * 0.52, oy - oh);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ox - ow * 0.40, oy - oh); ctx.lineTo(ox - ow * 0.62, oy); ctx.stroke();
      }
      // The broken colossus: a colossal head in profile, cracked
      // at the crown, with its fallen forearm beside it.
      const hx = w * 0.66, hy = h * 0.86, hs = h * 0.30;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(hx - hs * 0.52, hy);
      ctx.lineTo(hx - hs * 0.55, hy - hs * 0.52); // jaw and face front
      ctx.lineTo(hx - hs * 0.30, hy - hs * 0.60);
      ctx.lineTo(hx - hs * 0.34, hy - hs * 0.88); // brow
      ctx.lineTo(hx - hs * 0.05, hy - hs * 0.80); // the crack: crown dips
      ctx.lineTo(hx + hs * 0.10, hy - hs * 0.97); // crown peak
      ctx.lineTo(hx + hs * 0.48, hy - hs * 0.90);
      ctx.lineTo(hx + hs * 0.55, hy - hs * 0.40);
      ctx.lineTo(hx + hs * 0.50, hy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = silColor(td.palette.deep, 0.30); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx - hs * 0.05, hy - hs * 0.80); ctx.lineTo(hx + hs * 0.16, hy - hs * 0.45); ctx.stroke();
      ctx.fillStyle = silColor(td.palette.deep, 0.24);
      ctx.fillRect(hx - hs * 0.44, hy - hs * 0.44, hs * 0.30, hs * 0.07); // the eye slit, unlit
      const fx = hx + hs * 0.95, fy = hy - hs * 0.10;
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.ellipse(fx, fy, hs * 0.42, hs * 0.13, -0.18, 0, Math.PI * 2); ctx.fill(); // fallen forearm
      for (let fg = 0; fg < 3; fg++) { // three finger blocks
        ctx.fillRect(fx + hs * (0.28 + fg * 0.14), fy - hs * 0.16 - fg * hs * 0.02, hs * 0.09, hs * 0.14);
      }
    });
  }

  // World 8 mid: wind-blown sand sheets (wide, faint, fast in
  // feel: long horizontal streaks) and tumbling shards of
  // pottery-bright stone.
function paintSandsMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(802);
    tiled(ctx, w, () => {
      // Sand sheets: very flat ellipses at low alpha, in the
      // palette's bright band so they read as lit dust, not fog.
      for (let k = 0; k < 9; k++) {
        const cx = rnd() * w, cy = h * (0.10 + rnd() * 0.72);
        const rx = 90 + rnd() * 170, ry = 3 + rnd() * 6;
        ctx.fillStyle = silColor(td.palette.bright, 1.0, 0.05 + rnd() * 0.04);
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      }
      // Pottery shards: small angular pieces with one lit edge.
      for (let k = 0; k < 13; k++) {
        const cx = rnd() * w, cy = h * (0.12 + rnd() * 0.66);
        const R = 7 + rnd() * 13, rot = rnd() * Math.PI * 2;
        ctx.fillStyle = silColor(td.palette.deep, 0.62);
        ctx.beginPath();
        for (let vIdx = 0; vIdx < 4; vIdx++) {
          const a = rot + (vIdx / 4) * Math.PI * 2;
          const rr = R * (0.6 + rnd() * 0.55);
          const vx = cx + Math.cos(a) * rr, vy = cy + Math.sin(a) * rr * 0.8;
          if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.30);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - R * 0.6, cy - R * 0.3); ctx.lineTo(cx + R * 0.4, cy - R * 0.55); ctx.stroke();
      }
    });
  }

  // World 8 ground: a dune ridge line with ruins half-buried:
  // block tops and a broken column shoulder out of the sand
  // along the line.
function paintGroundDune(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(803);
    const yAt = (x: number) => 30 + 6 * Math.sin((2 * Math.PI * 3 * x) / w + 0.8) + 3 * Math.sin((2 * Math.PI * 8 * x) / w);
    // Warm haze wash above the line.
    const grad = ctx.createLinearGradient(0, 8, 0, 34);
    grad.addColorStop(0, silColor(td.palette.mid, 1.0, 0.10));
    grad.addColorStop(1, silColor(td.palette.mid, 1.0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 8, w, 26);
    // Sand mass below the line.
    const grad2 = ctx.createLinearGradient(0, 26, 0, h);
    grad2.addColorStop(0, silColor(td.palette.deep, 0.34));
    grad2.addColorStop(1, silColor(td.palette.deep, 0.20));
    ctx.fillStyle = grad2;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The ridge line itself, sunlit.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.6);
    ctx.lineWidth = 3;
    ctx.stroke();
    // Half-buried ruins: block tops and one broken column,
    // sunk into the ridge at their bases.
    ctx.fillStyle = silColor(td.palette.deep, 0.55);
    for (let k = 0; k < 6; k++) {
      const bx = rnd() * w, bw = 22 + rnd() * 34, bh = 8 + rnd() * 12;
      ctx.fillRect(bx, yAt(bx) - bh + 4, bw, bh);
    }
    const cx0 = rnd() * w;
    ctx.fillRect(cx0, yAt(cx0) - 26, 11, 30);
    ctx.fillRect(cx0 - 3, yAt(cx0) - 30, 17, 6); // capital fragment
  }

  // World 9 far: gothic spires and dead trees (Blood Moon
  // sheet). The moon itself is not painted here: it waxes with
  // run progress, so it lives on its own mesh (applyThemeScene).
function paintBloodFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(901);
    const fill = silColor(td.palette.deep, 0.52);
    const base = h * 0.99;
    tiled(ctx, w, () => {
      // Gothic spires: thin towers with a pointed cap and a
      // crossbar or two, rooted at the base line.
      for (let k = 0; k < 6; k++) {
        const sx = rnd() * w, sw = 9 + rnd() * 13, sh = h * (0.24 + rnd() * 0.30);
        ctx.fillStyle = fill;
        ctx.fillRect(sx - sw / 2, base - sh, sw, sh);
        ctx.beginPath();
        ctx.moveTo(sx - sw * 0.72, base - sh);
        ctx.lineTo(sx, base - sh - sw * 1.5);
        ctx.lineTo(sx + sw * 0.72, base - sh);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(sx - sw * 0.95, base - sh * (0.45 + rnd() * 0.2), sw * 1.9, 3.5); // crossbar
      }
      // Dead trees: a tapering trunk and bare recursive-looking
      // branches, drawn as tapering strokes.
      const branch = (x: number, y: number, ang: number, len: number, wd: number, depth: number) => {
        const ex = x + Math.cos(ang) * len, ey = y - Math.sin(ang) * len;
        ctx.strokeStyle = fill; ctx.lineWidth = wd;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        if (depth <= 0) return;
        branch(ex, ey, ang + 0.38 + rnd() * 0.25, len * 0.68, wd * 0.62, depth - 1);
        branch(ex, ey, ang - 0.34 - rnd() * 0.25, len * 0.64, wd * 0.62, depth - 1);
        if (rnd() < 0.5) branch(ex, ey, ang + (rnd() - 0.5) * 0.2, len * 0.5, wd * 0.5, depth - 1);
      };
      for (let k = 0; k < 4; k++) {
        branch(rnd() * w, base, Math.PI / 2 + (rnd() - 0.5) * 0.14, h * (0.15 + rnd() * 0.07), 7, 3);
      }
    });
  }

  // World 9 mid: floating rock shards and bone-like shards,
  // moonlit on one edge.
function paintBloodMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(902);
    const fill = silColor(td.palette.deep, 0.62);
    const rim = silColor(td.palette.mid, 1.0, 0.28);
    tiled(ctx, w, () => {
      for (let k = 0; k < 10; k++) {
        const cx = rnd() * w, cy = h * (0.14 + rnd() * 0.6);
        const R = 10 + rnd() * 22, rot = rnd() * Math.PI * 2;
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let vIdx = 0; vIdx < 5; vIdx++) {
          const a = rot + (vIdx / 5) * Math.PI * 2;
          const rr = R * (0.6 + rnd() * 0.55);
          const vx = cx + Math.cos(a) * rr, vy = cy + Math.sin(a) * rr * 0.8;
          if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - R * 0.55, cy - R * 0.35); ctx.lineTo(cx + R * 0.3, cy - R * 0.6); ctx.stroke();
      }
      // Bone shards: pale elongated capsules with knob ends,
      // dimmer than any pickup, unmistakably debris. Kept small
      // and dim: a first cut at stage size read as a bright
      // gray chain across the menu (Stage 8 screenshot review).
      for (let k = 0; k < 5; k++) {
        const cx = rnd() * w, cy = h * (0.2 + rnd() * 0.55);
        const len = 9 + rnd() * 13, ang = rnd() * Math.PI;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        ctx.strokeStyle = silColor([0.72, 0.60, 0.52], 1.0, 0.19);
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx - dx * len / 2, cy - dy * len / 2); ctx.lineTo(cx + dx * len / 2, cy + dy * len / 2); ctx.stroke();
        ctx.fillStyle = silColor([0.72, 0.60, 0.52], 1.0, 0.19);
        for (const sgn of [-1, 1]) {
          ctx.beginPath(); ctx.arc(cx + dx * len / 2 * sgn, cy + dy * len / 2 * sgn, 2.9, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
  }

  // World 9 ground: a dark ridge with the moon's reflection in
  // a thin red line along its crest.
function paintGroundBloodRidge(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const yAt = (x: number) => 30 + 5 * Math.sin((2 * Math.PI * 2 * x) / w + 2.1) + 4 * Math.sin((2 * Math.PI * 6 * x) / w + 0.4);
    // Ridge mass: the darkest ground in the game so far.
    const grad = ctx.createLinearGradient(0, 24, 0, h);
    grad.addColorStop(0, silColor(td.palette.deep, 0.50));
    grad.addColorStop(1, silColor(td.palette.deep, 0.34));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The moon's reflection: a thin red line riding the crest.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, yAt(x));
    ctx.strokeStyle = silColor(td.palette.bright, 1.0, 0.55);
    ctx.lineWidth = 2;
    ctx.shadowColor = silColor(td.palette.bright, 1.0, 0.7);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // World 10 far: broken world shards, one silhouette motif
  // from each of the nine worlds before it (Abyssal Rift
  // sheet), drifting in the black. The palette's deep band is
  // true black, so the shards are drawn in the mid violet
  // darkened, with a bright edge catching the rift light on a
  // few of them.
function paintRiftFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const fill = silColor(td.palette.mid, 0.60);
    const edge = silColor(td.palette.bright, 1.0, 0.35);
    // Nine motifs on a loose scatter, each a simplified glyph
    // of its world's far layer. Drawn once across the tile;
    // the tiled() wrap keeps the field continuous.
    const motifs: Array<[number, number, number, (x: number, y: number, s: number) => void]> = [
      [0.06, 0.62, 46, (x, y, s) => { // basalt spire (World 1)
        ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s); ctx.lineTo(x - s * 0.1, y - s * 0.6); ctx.lineTo(x + s * 0.12, y - s); ctx.lineTo(x + s * 0.3, y - s * 0.55); ctx.lineTo(x + s * 0.34, y + s); ctx.closePath(); ctx.fill();
      }],
      [0.17, 0.34, 40, (x, y, s) => { // sunken pillar (World 2)
        ctx.fillRect(x - s * 0.16, y - s, s * 0.32, s * 2);
        ctx.fillRect(x - s * 0.3, y - s, s * 0.6, s * 0.18);
        ctx.fillRect(x - s * 0.3, y + s * 0.82, s * 0.6, s * 0.18);
      }],
      [0.28, 0.70, 42, (x, y, s) => { // crystal shard (World 3)
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.34, y); ctx.lineTo(x, y + s * 0.4); ctx.lineTo(x - s * 0.34, y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.34, y); ctx.stroke();
      }],
      [0.39, 0.28, 36, (x, y, s) => { // leaf (World 4)
        ctx.beginPath(); ctx.ellipse(x, y, s * 0.36, s * 0.85, 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s * 0.7); ctx.lineTo(x + s * 0.3, y - s * 0.7); ctx.stroke();
      }],
      [0.50, 0.58, 48, (x, y, s) => { // peak (World 5)
        ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.7); ctx.lineTo(x - s * 0.2, y - s * 0.5); ctx.lineTo(x + s * 0.15, y - s * 0.1); ctx.lineTo(x + s * 0.45, y - s * 0.75); ctx.lineTo(x + s, y + s * 0.7); ctx.closePath(); ctx.fill();
      }],
      [0.61, 0.32, 44, (x, y, s) => { // cathedral shard (World 6)
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.26, y + s * 0.3); ctx.lineTo(x, y + s * 0.55); ctx.lineTo(x - s * 0.26, y + s * 0.3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.55); ctx.lineTo(x - s * 0.36, y - s * 0.3); ctx.lineTo(x - s * 0.2, y + s * 0.55); ctx.closePath(); ctx.fill();
      }],
      [0.72, 0.66, 38, (x, y, s) => { // ringed planet fragment (World 7)
        ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, s * 1.05, s * 0.24, -0.32, 0, Math.PI * 2); ctx.stroke();
      }],
      [0.83, 0.36, 42, (x, y, s) => { // obelisk (World 8)
        ctx.beginPath(); ctx.moveTo(x - s * 0.2, y + s); ctx.lineTo(x - s * 0.13, y - s * 0.7); ctx.lineTo(x, y - s); ctx.lineTo(x + s * 0.13, y - s * 0.7); ctx.lineTo(x + s * 0.2, y + s); ctx.closePath(); ctx.fill();
      }],
      [0.93, 0.60, 40, (x, y, s) => { // dead tree (World 9)
        ctx.strokeStyle = fill; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x + s * 0.06, y - s * 0.5); ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + s * 0.06, y - s * 0.5); ctx.lineTo(x - s * 0.4, y - s * 0.85); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + s * 0.06, y - s * 0.5); ctx.lineTo(x + s * 0.45, y - s * 0.95); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + s * 0.02, y - s * 0.15); ctx.lineTo(x + s * 0.5, y - s * 0.4); ctx.stroke();
      }],
    ];
    tiled(ctx, w, () => {
      for (const [fx, fy, s, draw] of motifs) {
        ctx.fillStyle = fill;
        draw(fx * w, fy * h, s);
      }
    });
  }

  // World 10 mid: rift shards of black glass with bright edges:
  // near-black violet polygons, one edge each lit star white.
function paintRiftMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(1002);
    const fill = silColor(td.palette.mid, 0.34);
    const edge = silColor(td.palette.bright, 1.0, 0.55);
    tiled(ctx, w, () => {
      for (let k = 0; k < 13; k++) {
        const cx = rnd() * w, cy = h * (0.10 + rnd() * 0.72);
        const R = 10 + rnd() * 24, rot = rnd() * Math.PI * 2;
        const verts = 4 + Math.floor(rnd() * 3);
        const pts: Array<[number, number]> = [];
        for (let vIdx = 0; vIdx < verts; vIdx++) {
          const a = rot + (vIdx / verts) * Math.PI * 2;
          const rr = R * (0.6 + rnd() * 0.55);
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82]);
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        pts.forEach(([vx, vy], idx) => { if (idx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy); });
        ctx.closePath(); ctx.fill();
        // The bright edge: the shard's longest upper edge.
        ctx.strokeStyle = edge; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
      }
    });
  }

  // World 10 ground: none (World 10 sheet). The horizon band
  // is removed for the only time in the game; the player flies
  // over open void with the rift's glow below. The absence is
  // the theme, so this painter paints nothing.
function paintGroundNone(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    // Intentionally empty: no ground strip for the Abyssal Rift.
  }
