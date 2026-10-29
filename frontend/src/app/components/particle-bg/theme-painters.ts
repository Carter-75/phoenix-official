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

  // Side wall painters (World 1 Finish; Worlds 2 to 10 added in
  // the Worlds 2 to 10 pass), dispatched by the world index whose
  // scroll record carries the wall key. A wall painter draws one
  // vertical strip: canvas x = 0 is the wall face line (the
  // innermost extent of the art, where the bird's flight clamps),
  // x = w is the outer edge past the screen edge. Everything is
  // drawn with vertical wrap copies, so the strip tiles in Y by
  // construction.
export function wallPainters(worldIndex: number) {
    switch (worldIndex) {
      case 0: return paintEmberWall;
      case 1: return paintReefWall;
      case 2: return paintShardWall;
      case 3: return paintRootWall;
      case 4: return paintCragWall;
      case 5: return paintCrystalWall;
      case 6: return paintIceWall;
      case 7: return paintRuinWall;
      case 8: return paintThornWall;
      case 9: return paintRiftWall;
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
    // backdrop shows through between the spike tips. All four
    // profile paths (this cut, the clip, the wash, the rim)
    // sample the periodic profile past both canvas edges (from
    // -20 to h + 20), so their closing segments fall off-canvas:
    // sampling only to h + 4 in steps of 16 used to end the
    // paths at y = h - 4 and cut a diagonal wedge across the
    // strip's last rows, which the wrap seam gate caught on the
    // Worlds 2 to 10 walls with bright content in those rows.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, -20);
    for (let y = -20; y <= h + 20; y += 16) ctx.lineTo(profileX(y), y);
    ctx.lineTo(0, h + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Clip the interior details to the rock side of the profile
    // so nothing floats in the transparent channel zone.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w + 4, -20);
    for (let y = -20; y <= h + 20; y += 16) ctx.lineTo(profileX(y), y);
    ctx.lineTo(w + 4, h + 20);
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
    ctx.moveTo(w + 4, -20);
    for (let y = -20; y <= h + 20; y += 16) ctx.lineTo(profileX(y), y);
    for (let y = h + 20; y >= -20; y -= 16) ctx.lineTo(profileX(y) + w * 0.16, y);
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
    for (let y = -20; y <= h + 20; y += 16) {
      const x = profileX(y);
      if (y === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = silColor(P.mid, 0.9, 0.30);
    ctx.lineWidth = 8;
    ctx.stroke();
  }

  // ----------------------------------------------------------------
  // Worlds 2 to 10 walls: one shared engine, the Ember wall's
  // construction (periodic profile, cut back to transparent on
  // the channel side, interior features clipped to the rock,
  // protrusions jutting toward the face line, rim light on the
  // profile), with per-world feature and protrusion painters
  // plugged in. Every feature list is generated ONCE from the
  // world's seed and drawn identically at every vertical wrap
  // offset, so each strip tiles in Y by construction, exactly
  // like the Ember wall.
  // ----------------------------------------------------------------

interface WallCfg {
  seed: number;
  baseStops: [number, number, number];
  features: (ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme, rnd: () => number) => void;
  spikes: (ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme, rnd: () => number, profileX: (y: number) => number) => void;
  rimBright: number; rimBrightAlpha: number; rimMid: number; rimMidAlpha: number;
  washFactor: number; washAlpha: number;
}

function paintRockWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme, cfg: WallCfg) {
    const rnd = themeRng(cfg.seed);
    const P = td.palette;
    const base = ctx.createLinearGradient(0, 0, w, 0);
    base.addColorStop(0, silColor(P.deep, cfg.baseStops[0]));
    base.addColorStop(0.3, silColor(P.deep, cfg.baseStops[1]));
    base.addColorStop(1, silColor(P.deep, cfg.baseStops[2]));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // The jagged profile: whole-period sines, periodic in y by
    // construction; the cut, the rim, the wash, and the spike
    // anchors all share this one shape (the Ember wall's law).
    const ph1 = rnd() * Math.PI * 2, ph2 = rnd() * Math.PI * 2, ph3 = rnd() * Math.PI * 2;
    const profileX = (y: number) => w * 0.31
      + Math.sin((y / h) * Math.PI * 2 * 2 + ph1) * w * 0.045
      + Math.sin((y / h) * Math.PI * 2 * 3 + ph2) * w * 0.030
      + Math.sin((y / h) * Math.PI * 2 * 5 + ph3) * w * 0.018;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, -20);
    for (let y = -20; y <= h + 20; y += 16) ctx.lineTo(profileX(y), y);
    ctx.lineTo(0, h + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w + 4, -20);
    for (let y = -20; y <= h + 20; y += 16) ctx.lineTo(profileX(y), y);
    ctx.lineTo(w + 4, h + 20);
    ctx.closePath();
    ctx.clip();
    cfg.features(ctx, w, h, td, rnd);
    // A soft wash of the world's glow along the profile, inside
    // the rock, so the face reads lit rather than cut out.
    ctx.save();
    ctx.globalAlpha = cfg.washAlpha;
    ctx.fillStyle = silColor(P.mid, cfg.washFactor);
    ctx.beginPath();
    ctx.moveTo(w + 4, -20);
    for (let y = -20; y <= h + 20; y += 16) ctx.lineTo(profileX(y), y);
    for (let y = h + 20; y >= -20; y -= 16) ctx.lineTo(profileX(y) + w * 0.16, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore(); // the rock-side clip
    cfg.spikes(ctx, w, h, td, rnd, profileX);
    // The rim light along the profile itself.
    ctx.strokeStyle = silColor(P.bright, cfg.rimBright, cfg.rimBrightAlpha);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let y = -20; y <= h + 20; y += 16) {
      const x = profileX(y);
      if (y === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = silColor(P.mid, cfg.rimMid, cfg.rimMidAlpha);
    ctx.lineWidth = 8;
    ctx.stroke();
  }

  // Fractured rock facets, the Ember wall's interior language,
  // shared by the rock worlds (reef, crags, thorns) with their
  // own palettes and stroke strengths.
type WallFacet = { fx: number; fy: number; fw: number; fh: number; shade: number; j: number[] };
function genWallFacets(rnd: () => number, w: number, h: number, count: number): WallFacet[] {
    const facets: WallFacet[] = [];
    for (let i = 0; i < count; i++) {
      facets.push({
        fx: w * (0.30 + rnd() * 0.68), fy: rnd() * h,
        fw: w * (0.08 + rnd() * 0.20), fh: 26 + rnd() * 74,
        shade: 0.30 + rnd() * 0.38,
        j: [(rnd() - 0.5) * 8, 0.2 + rnd() * 0.3, 0.5 + rnd() * 0.4, 0.1 + rnd() * 0.3, 0.6 + rnd() * 0.3]
      });
    }
    return facets;
  }
function drawWallFacets(ctx: CanvasRenderingContext2D, facets: WallFacet[], P: WorldTheme['palette'], strokeAlpha: number) {
    for (const f of facets) {
      ctx.fillStyle = silColor(P.deep, f.shade, 0.85);
      ctx.beginPath();
      ctx.moveTo(f.fx + f.j[0], f.fy);
      ctx.lineTo(f.fx + f.fw, f.fy + f.fh * f.j[1]);
      ctx.lineTo(f.fx + f.fw * f.j[2], f.fy + f.fh);
      ctx.lineTo(f.fx - f.fw * f.j[3], f.fy + f.fh * f.j[4]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = silColor(P.bright, 0.5, strokeAlpha);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // World 2 wall, Cerulean Depths (key 'reef'): sunken reef rock
  // with coral fans, anemone glow dots inside the rock, and coral
  // branches jutting toward the face line.
export function paintReefWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 2501, baseStops: [0.72, 0.58, 0.34],
      rimBright: 0.9, rimBrightAlpha: 0.55, rimMid: 0.9, rimMidAlpha: 0.28,
      washFactor: 0.8, washAlpha: 0.15,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const facets = genWallFacets(rnd, cw, ch, 24);
        const fans: { fx: number; fy: number; r: number }[] = [];
        for (let i = 0; i < 6; i++) fans.push({ fx: cw * (0.42 + rnd() * 0.5), fy: rnd() * ch, r: 16 + rnd() * 18 });
        const anemones: { ax: number; ay: number; dots: [number, number, number][] }[] = [];
        for (let i = 0; i < 9; i++) {
          const ax = cw * (0.40 + rnd() * 0.54), ay = rnd() * ch;
          const dots: [number, number, number][] = [];
          for (let d = 0; d < 6; d++) dots.push([ax + (rnd() - 0.5) * 22, ay + (rnd() - 0.5) * 16, 1.4 + rnd() * 1.8]);
          anemones.push({ ax, ay, dots });
        }
        vtiled(c, ch, () => {
          drawWallFacets(c, facets, P, 0.13);
          c.strokeStyle = silColor(P.mid, 1.0, 0.32);
          c.lineWidth = 2;
          for (const f of fans) {
            for (let s = -2; s <= 2; s++) {
              c.beginPath();
              c.moveTo(f.fx, f.fy + f.r * 0.5);
              c.quadraticCurveTo(f.fx + s * f.r * 0.28, f.fy - f.r * 0.2, f.fx + s * f.r * 0.42, f.fy - f.r * 0.55);
              c.stroke();
            }
          }
          for (const a of anemones) {
            const g = c.createRadialGradient(a.ax, a.ay, 0, a.ax, a.ay, 15);
            g.addColorStop(0, silColor(P.bright, 1.0, 0.13));
            g.addColorStop(1, silColor(P.bright, 1.0, 0));
            c.fillStyle = g;
            c.fillRect(a.ax - 15, a.ay - 15, 30, 30);
            c.fillStyle = silColor(P.bright, 1.0, 0.55);
            for (const [dx, dy, dr] of a.dots) {
              c.beginPath(); c.arc(dx, dy, dr, 0, Math.PI * 2); c.fill();
            }
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const branches: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          branches.push({ sy, anchor, len: anchor - 4 - rnd() * cw * 0.06, halfBase: 9 + rnd() * 12, tipDy: (rnd() - 0.5) * 8 });
        }
        vtiled(c, ch, () => {
          for (const s of branches) {
            c.fillStyle = silColor(P.deep, 0.62);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.lineTo(s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            // Side twigs, the coral read.
            for (const sgn of [-1, 1]) {
              c.beginPath();
              c.moveTo(s.anchor - s.len * 0.45, s.sy + s.tipDy * 0.5 + sgn * s.halfBase * 0.3);
              c.lineTo(s.anchor - s.len * 0.72, s.sy + s.tipDy * 0.7 + sgn * s.halfBase * 1.05);
              c.lineTo(s.anchor - s.len * 0.30, s.sy + s.tipDy * 0.4 + sgn * s.halfBase * 0.55);
              c.closePath();
              c.fill();
            }
            c.strokeStyle = silColor(P.bright, 0.85, 0.5);
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy);
            c.stroke();
          }
        });
      },
    });
  }

  // World 3 wall, Amethyst Void (key 'shards'): a mass of crystal
  // plates with faceted chips, and long crystal diamonds jutting
  // toward the face line.
export function paintShardWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 3501, baseStops: [0.66, 0.52, 0.30],
      rimBright: 0.95, rimBrightAlpha: 0.6, rimMid: 0.9, rimMidAlpha: 0.30,
      washFactor: 0.85, washAlpha: 0.16,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const plates: { pts: [number, number][]; edge: [number, number][]; shade: number }[] = [];
        for (let i = 0; i < 14; i++) {
          const cx = cw * (0.38 + rnd() * 0.58), cy = rnd() * ch;
          const len = 40 + rnd() * 70, wid = 9 + rnd() * 13, a = (rnd() - 0.5) * 0.9;
          const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
          const pts: [number, number][] = [
            [cx - ux * len * 0.5, cy - uy * len * 0.5],
            [cx + vx * wid, cy + vy * wid],
            [cx + ux * len * 0.5, cy + uy * len * 0.5],
            [cx - vx * wid, cy - vy * wid],
          ];
          plates.push({ pts, edge: [pts[0], pts[1]], shade: 0.34 + rnd() * 0.36 });
        }
        const chips: { pts: [number, number][] }[] = [];
        for (let i = 0; i < 10; i++) {
          const cx = cw * (0.36 + rnd() * 0.6), cy = rnd() * ch, r = 6 + rnd() * 9;
          chips.push({ pts: [[cx, cy - r], [cx + r * 0.8, cy + r * 0.6], [cx - r * 0.8, cy + r * 0.6]] });
        }
        vtiled(c, ch, () => {
          for (const p of plates) {
            c.fillStyle = silColor(P.deep, p.shade, 0.88);
            c.beginPath();
            p.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.closePath(); c.fill();
            c.strokeStyle = silColor(P.mid, 1.0, 0.38);
            c.lineWidth = 1.8;
            c.beginPath(); c.moveTo(p.edge[0][0], p.edge[0][1]); c.lineTo(p.edge[1][0], p.edge[1][1]); c.stroke();
          }
          c.fillStyle = silColor(P.deep, 0.55, 0.8);
          for (const chp of chips) {
            c.beginPath();
            chp.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.closePath(); c.fill();
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const shards: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
        for (let i = 0; i < 7; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          shards.push({ sy, anchor, len: anchor - 3 - rnd() * cw * 0.05, halfBase: 6 + rnd() * 8, tipDy: (rnd() - 0.5) * 10 });
        }
        vtiled(c, ch, () => {
          for (const s of shards) {
            c.fillStyle = silColor(P.deep, 0.70);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.06, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.lineTo(s.anchor + cw * 0.06, s.sy + s.halfBase);
            c.lineTo(s.anchor - s.len * 0.42, s.sy + s.tipDy * 0.45);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(P.bright, 0.9, 0.6);
            c.lineWidth = 1.8;
            c.beginPath();
            c.moveTo(s.anchor - s.len, s.sy + s.tipDy);
            c.lineTo(s.anchor - s.len * 0.42, s.sy + s.tipDy * 0.45);
            c.stroke();
          }
        });
      },
    });
  }

  // World 4 wall, Verdant Canopy (key 'roots'): a root and trunk
  // mass with root strands and leaf clusters inside, and curved
  // root spikes jutting toward the face line.
export function paintRootWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 4501, baseStops: [0.60, 0.46, 0.26],
      rimBright: 0.9, rimBrightAlpha: 0.5, rimMid: 0.9, rimMidAlpha: 0.26,
      washFactor: 0.8, washAlpha: 0.14,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const strands: { pts: [number, number][]; wd: number }[] = [];
        for (let i = 0; i < 12; i++) {
          let sx = cw * (0.36 + rnd() * 0.6), sy = rnd() * ch;
          const pts: [number, number][] = [[sx, sy]];
          for (let s = 0; s < 3; s++) { sx += (rnd() - 0.35) * 30; sy += 34 + rnd() * 40; pts.push([sx, sy]); }
          strands.push({ pts, wd: 4 + rnd() * 5 });
        }
        const leaves: { lx: number; ly: number; len: number; a: number }[] = [];
        for (let i = 0; i < 24; i++) leaves.push({ lx: cw * (0.38 + rnd() * 0.58), ly: rnd() * ch, len: 9 + rnd() * 8, a: rnd() * Math.PI * 2 });
        vtiled(c, ch, () => {
          c.lineCap = 'round';
          for (const s of strands) {
            c.strokeStyle = silColor(P.deep, 1.22, 0.75);
            c.lineWidth = s.wd;
            c.beginPath();
            s.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.stroke();
          }
          for (const l of leaves) {
            c.save();
            c.translate(l.lx, l.ly); c.rotate(l.a);
            c.fillStyle = silColor(P.mid, 1.0, 0.42);
            c.beginPath();
            c.moveTo(0, -l.len);
            c.quadraticCurveTo(l.len * 0.45, 0, 0, l.len);
            c.quadraticCurveTo(-l.len * 0.45, 0, 0, -l.len);
            c.closePath(); c.fill();
            c.restore();
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const roots: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          roots.push({ sy, anchor, len: anchor - 4 - rnd() * cw * 0.06, halfBase: 10 + rnd() * 13, tipDy: (rnd() - 0.5) * 10 });
        }
        vtiled(c, ch, () => {
          for (const s of roots) {
            c.fillStyle = silColor(P.deep, 0.58);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.quadraticCurveTo(s.anchor - s.len * 0.5, s.sy - s.halfBase * 0.35, s.anchor - s.len, s.sy + s.tipDy);
            c.quadraticCurveTo(s.anchor - s.len * 0.5, s.sy + s.halfBase * 0.35, s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(P.bright, 0.85, 0.45);
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.quadraticCurveTo(s.anchor - s.len * 0.5, s.sy - s.halfBase * 0.35, s.anchor - s.len, s.sy + s.tipDy);
            c.stroke();
          }
        });
      },
    });
  }

  // World 5 wall, Ashen Peaks (key 'crags'): gray crag rock with
  // ash drifts settled inside it and jagged crag teeth jutting
  // toward the face line. The one desaturated wall: no glow
  // accents anywhere, value contrast only, like its world.
export function paintCragWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 5501, baseStops: [0.85, 0.68, 0.42],
      rimBright: 0.95, rimBrightAlpha: 0.5, rimMid: 1.0, rimMidAlpha: 0.25,
      washFactor: 0.9, washAlpha: 0.10,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const facets = genWallFacets(rnd, cw, ch, 26);
        const drifts: { dx: number; dy: number; rx: number }[] = [];
        for (let i = 0; i < 8; i++) drifts.push({ dx: cw * (0.36 + rnd() * 0.58), dy: rnd() * ch, rx: 20 + rnd() * 30 });
        const cracks: { pts: [number, number][] }[] = [];
        for (let i = 0; i < 7; i++) {
          let px = cw * (0.42 + rnd() * 0.5), py = rnd() * ch;
          const pts: [number, number][] = [[px, py]];
          for (let s = 0; s < 3; s++) { px += (rnd() - 0.5) * 22; py += 20 + rnd() * 26; pts.push([px, py]); }
          cracks.push({ pts });
        }
        vtiled(c, ch, () => {
          drawWallFacets(c, facets, P, 0.10);
          for (const d of drifts) {
            c.save();
            c.translate(d.dx, d.dy);
            c.scale(1, 0.26);
            const g = c.createRadialGradient(0, 0, 0, 0, 0, d.rx);
            g.addColorStop(0, silColor(P.bright, 1.0, 0.13));
            g.addColorStop(1, silColor(P.bright, 1.0, 0));
            c.fillStyle = g;
            c.fillRect(-d.rx, -d.rx, d.rx * 2, d.rx * 2);
            c.restore();
          }
          c.strokeStyle = silColor(P.deep, 0.22, 0.8);
          c.lineWidth = 2;
          for (const cr of cracks) {
            c.beginPath();
            cr.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.stroke();
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const teeth: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          teeth.push({ sy, anchor, len: anchor - 4 - rnd() * cw * 0.06, halfBase: 10 + rnd() * 14, tipDy: (rnd() - 0.5) * 8 });
        }
        vtiled(c, ch, () => {
          for (const s of teeth) {
            c.fillStyle = silColor(P.deep, 0.72);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len * 0.55, s.sy - s.halfBase * 0.45);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.lineTo(s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(P.bright, 1.0, 0.45);
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len * 0.55, s.sy - s.halfBase * 0.45);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.stroke();
          }
        });
      },
    });
  }

  // World 6 wall, Crystal Caverns (key 'crystal'): cyan cathedral
  // plates standing in the mass, glow pooled at their tips, and
  // broad crystal shards jutting toward the face line.
export function paintCrystalWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 6501, baseStops: [0.70, 0.55, 0.32],
      rimBright: 0.95, rimBrightAlpha: 0.6, rimMid: 0.9, rimMidAlpha: 0.30,
      washFactor: 0.85, washAlpha: 0.16,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const plates: { pts: [number, number][]; tip: [number, number]; shade: number }[] = [];
        for (let i = 0; i < 11; i++) {
          const cx = cw * (0.40 + rnd() * 0.56), topY = rnd() * ch;
          const len = 60 + rnd() * 90, wid = 10 + rnd() * 12;
          const lean = (rnd() - 0.5) * 14;
          const pts: [number, number][] = [
            [cx - wid, topY + len],
            [cx - wid * 0.4, topY + len * 0.4],
            [cx + lean, topY],
            [cx + wid * 0.5, topY + len * 0.45],
            [cx + wid, topY + len],
          ];
          plates.push({ pts, tip: [cx + lean, topY], shade: 0.36 + rnd() * 0.34 });
        }
        vtiled(c, ch, () => {
          for (const p of plates) {
            const g = c.createRadialGradient(p.tip[0], p.tip[1], 0, p.tip[0], p.tip[1], 17);
            g.addColorStop(0, silColor(P.bright, 1.0, 0.13));
            g.addColorStop(1, silColor(P.bright, 1.0, 0));
            c.fillStyle = g;
            c.fillRect(p.tip[0] - 17, p.tip[1] - 17, 34, 34);
            c.fillStyle = silColor(P.deep, p.shade, 0.88);
            c.beginPath();
            p.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.closePath(); c.fill();
            c.strokeStyle = silColor(P.bright, 1.0, 0.35);
            c.lineWidth = 1.8;
            c.beginPath(); c.moveTo(p.pts[1][0], p.pts[1][1]); c.lineTo(p.tip[0], p.tip[1]); c.lineTo(p.pts[3][0], p.pts[3][1]); c.stroke();
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const shards: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          shards.push({ sy, anchor, len: anchor - 4 - rnd() * cw * 0.05, halfBase: 12 + rnd() * 11, tipDy: (rnd() - 0.5) * 8 });
        }
        vtiled(c, ch, () => {
          for (const s of shards) {
            c.fillStyle = silColor(P.deep, 0.66);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.lineTo(s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(P.bright, 1.0, 0.5);
            c.lineWidth = 1.8;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase * 0.2);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.stroke();
          }
        });
      },
    });
  }

  // World 7 wall, Neon Nebula (key 'ice'): dark frozen rock with
  // translucent ice sheets and crack lines inside it, and pale
  // ice spikes jutting toward the face line.
export function paintIceWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const ICE: Rgb3 = [0.90, 0.97, 1.0];
    paintRockWall(ctx, w, h, td, {
      seed: 7501, baseStops: [0.66, 0.52, 0.30],
      rimBright: 1.0, rimBrightAlpha: 0.5, rimMid: 0.9, rimMidAlpha: 0.28,
      washFactor: 0.8, washAlpha: 0.13,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const sheets: { pts: [number, number][]; a: number }[] = [];
        for (let i = 0; i < 9; i++) {
          const cx = cw * (0.38 + rnd() * 0.58), cy = rnd() * ch;
          const len = 44 + rnd() * 66, wid = 12 + rnd() * 16, a = (rnd() - 0.5) * 0.7;
          const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
          sheets.push({
            pts: [
              [cx - ux * len * 0.5, cy - uy * len * 0.5],
              [cx + vx * wid, cy + vy * wid],
              [cx + ux * len * 0.5, cy + uy * len * 0.5],
              [cx - vx * wid, cy - vy * wid],
            ],
            a: 0.08 + rnd() * 0.08,
          });
        }
        const cracks: { pts: [number, number][] }[] = [];
        for (let i = 0; i < 10; i++) {
          let px = cw * (0.40 + rnd() * 0.54), py = rnd() * ch;
          const pts: [number, number][] = [[px, py]];
          for (let s = 0; s < 3; s++) { px += (rnd() - 0.5) * 30; py += 16 + rnd() * 24; pts.push([px, py]); }
          cracks.push({ pts });
        }
        vtiled(c, ch, () => {
          drawWallFacets(c, genWallFacets(rnd, cw, ch, 16), P, 0.10);
          for (const s of sheets) {
            c.fillStyle = silColor(ICE, 1.0, s.a);
            c.beginPath();
            s.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.closePath(); c.fill();
            c.strokeStyle = silColor(ICE, 1.0, 0.28);
            c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(s.pts[0][0], s.pts[0][1]); c.lineTo(s.pts[1][0], s.pts[1][1]); c.stroke();
          }
          c.strokeStyle = silColor(ICE, 1.0, 0.30);
          c.lineWidth = 1.4;
          for (const cr of cracks) {
            c.beginPath();
            cr.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.stroke();
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const shards: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
        for (let i = 0; i < 7; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          shards.push({ sy, anchor, len: anchor - 3 - rnd() * cw * 0.04, halfBase: 4 + rnd() * 5, tipDy: (rnd() - 0.5) * 7 });
        }
        vtiled(c, ch, () => {
          for (const s of shards) {
            c.fillStyle = silColor(ICE, 1.0, 0.45);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.lineTo(s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(ICE, 1.0, 0.65);
            c.lineWidth = 1.6;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.stroke();
          }
        });
      },
    });
  }

  // World 8 wall, Golden Sands (key 'ruins'): sandstone block
  // courses with worn seams and one broken column drum inside,
  // and stepped block teeth jutting toward the face line.
export function paintRuinWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 8501, baseStops: [0.74, 0.60, 0.38],
      rimBright: 0.95, rimBrightAlpha: 0.55, rimMid: 0.9, rimMidAlpha: 0.30,
      washFactor: 0.85, washAlpha: 0.15,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const rows: { y: number; hh: number; blocks: { x: number; bw: number; shade: number }[] }[] = [];
        const rowH = 34;
        for (let y = -rowH; y < ch + rowH; y += rowH) {
          const blocks: { x: number; bw: number; shade: number }[] = [];
          let bx = cw * 0.30 - rnd() * 30;
          while (bx < cw) {
            const bw = 34 + rnd() * 40;
            blocks.push({ x: bx, bw, shade: 0.34 + rnd() * 0.30 });
            bx += bw + 3;
          }
          rows.push({ y, hh: rowH - 3, blocks });
        }
        const drum: { dx: number; dy: number } = { dx: cw * (0.55 + rnd() * 0.3), dy: rnd() * ch };
        vtiled(c, ch, () => {
          for (const row of rows) {
            for (const b of row.blocks) {
              c.fillStyle = silColor(P.deep, b.shade, 0.55);
              c.fillRect(b.x, row.y, b.bw, row.hh);
            }
          }
          // The broken column drum: three stacked segments.
          c.fillStyle = silColor(P.deep, 0.62, 0.8);
          for (let s = 0; s < 3; s++) {
            c.beginPath();
            c.ellipse(drum.dx + (s % 2) * 3, drum.dy + s * 17, 17, 8, 0, 0, Math.PI * 2);
            c.fill();
          }
          c.strokeStyle = silColor(P.mid, 1.0, 0.4);
          c.lineWidth = 2;
          c.beginPath(); c.ellipse(drum.dx, drum.dy, 17, 8, 0, Math.PI, Math.PI * 2); c.stroke();
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const teeth: { sy: number; anchor: number; len: number; halfBase: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          teeth.push({ sy, anchor, len: anchor - 5 - rnd() * cw * 0.05, halfBase: 11 + rnd() * 12 });
        }
        vtiled(c, ch, () => {
          for (const s of teeth) {
            c.fillStyle = silColor(P.deep, 0.64);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len * 0.55, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len * 0.55, s.sy - s.halfBase * 0.45);
            c.lineTo(s.anchor - s.len, s.sy - s.halfBase * 0.45);
            c.lineTo(s.anchor - s.len, s.sy + s.halfBase * 0.45);
            c.lineTo(s.anchor - s.len * 0.55, s.sy + s.halfBase * 0.45);
            c.lineTo(s.anchor - s.len * 0.55, s.sy + s.halfBase);
            c.lineTo(s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(P.mid, 1.0, 0.5);
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len * 0.55, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len * 0.55, s.sy - s.halfBase * 0.45);
            c.lineTo(s.anchor - s.len, s.sy - s.halfBase * 0.45);
            c.stroke();
          }
        });
      },
    });
  }

  // World 9 wall, Blood Moon (key 'thorns'): near-black rock with
  // bone shards and dim red cracks inside it, and long curved
  // thorns jutting toward the face line, more of them than any
  // other world's spikes.
export function paintThornWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 9501, baseStops: [0.62, 0.48, 0.26],
      rimBright: 0.95, rimBrightAlpha: 0.5, rimMid: 0.9, rimMidAlpha: 0.28,
      washFactor: 0.8, washAlpha: 0.13,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const facets = genWallFacets(rnd, cw, ch, 24);
        const bones: { bx: number; by: number; len: number; ang: number }[] = [];
        for (let i = 0; i < 6; i++) bones.push({ bx: cw * (0.42 + rnd() * 0.5), by: rnd() * ch, len: 10 + rnd() * 12, ang: rnd() * Math.PI });
        const cracks: { pts: [number, number][] }[] = [];
        for (let i = 0; i < 7; i++) {
          let px = cw * (0.42 + rnd() * 0.5), py = rnd() * ch;
          const pts: [number, number][] = [[px, py]];
          for (let s = 0; s < 3; s++) { px += (rnd() - 0.5) * 20; py += 16 + rnd() * 24; pts.push([px, py]); }
          cracks.push({ pts });
        }
        vtiled(c, ch, () => {
          drawWallFacets(c, facets, P, 0.12);
          c.save();
          c.shadowColor = silColor(P.mid, 1.0);
          c.shadowBlur = 4;
          c.strokeStyle = silColor(P.bright, 1.0, 0.32);
          c.lineWidth = 1.6;
          for (const cr of cracks) {
            c.beginPath();
            cr.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.stroke();
          }
          c.restore();
          for (const b of bones) {
            const dx = Math.cos(b.ang), dy = Math.sin(b.ang);
            c.strokeStyle = silColor([0.72, 0.60, 0.52], 1.0, 0.24);
            c.lineWidth = 2.5;
            c.beginPath();
            c.moveTo(b.bx - dx * b.len / 2, b.by - dy * b.len / 2);
            c.lineTo(b.bx + dx * b.len / 2, b.by + dy * b.len / 2);
            c.stroke();
            c.fillStyle = silColor([0.72, 0.60, 0.52], 1.0, 0.24);
            for (const sgn of [-1, 1]) {
              c.beginPath(); c.arc(b.bx + dx * b.len / 2 * sgn, b.by + dy * b.len / 2 * sgn, 2.8, 0, Math.PI * 2); c.fill();
            }
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const thorns: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number; bend: number }[] = [];
        for (let i = 0; i < 8; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          thorns.push({ sy, anchor, len: anchor - 3 - rnd() * cw * 0.04, halfBase: 5 + rnd() * 5, tipDy: (rnd() - 0.5) * 12, bend: (rnd() - 0.5) * 16 });
        }
        vtiled(c, ch, () => {
          for (const s of thorns) {
            c.fillStyle = silColor(P.deep, 0.30);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.quadraticCurveTo(s.anchor - s.len * 0.5, s.sy - s.halfBase * 0.4 + s.bend * 0.4, s.anchor - s.len, s.sy + s.tipDy + s.bend);
            c.quadraticCurveTo(s.anchor - s.len * 0.5, s.sy + s.halfBase * 0.4 + s.bend * 0.4, s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(P.bright, 1.0, 0.45);
            c.lineWidth = 1.8;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.quadraticCurveTo(s.anchor - s.len * 0.5, s.sy - s.halfBase * 0.4 + s.bend * 0.4, s.anchor - s.len, s.sy + s.tipDy + s.bend);
            c.stroke();
          }
        });
      },
    });
  }

  // World 10 wall, Abyssal Rift (key 'riftshards'): black glass
  // plates in the void, each with one star-white lit edge, and
  // glass shards jutting toward the face line. The palette's
  // deep band is true black, so the plate fills ride the mid
  // violet darkened, like the world's far motifs.
export function paintRiftWall(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    paintRockWall(ctx, w, h, td, {
      seed: 10501, baseStops: [0.5, 0.4, 0.24],
      rimBright: 0.95, rimBrightAlpha: 0.55, rimMid: 0.9, rimMidAlpha: 0.30,
      washFactor: 0.7, washAlpha: 0.12,
      features: (c, cw, ch, t, rnd) => {
        const P = t.palette;
        const plates: { pts: [number, number][]; edge: [number, number][] }[] = [];
        for (let i = 0; i < 13; i++) {
          const cx = cw * (0.38 + rnd() * 0.58), cy = rnd() * ch;
          const R = 16 + rnd() * 30, rot = rnd() * Math.PI * 2;
          const verts = 4 + Math.floor(rnd() * 3);
          const pts: [number, number][] = [];
          for (let v = 0; v < verts; v++) {
            const a = rot + (v / verts) * Math.PI * 2;
            const rr = R * (0.6 + rnd() * 0.55);
            pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82]);
          }
          plates.push({ pts, edge: [pts[0], pts[1]] });
        }
        const glows: { gx: number; gy: number; r: number }[] = [];
        for (let i = 0; i < 5; i++) glows.push({ gx: cw * (0.42 + rnd() * 0.5), gy: rnd() * ch, r: 22 + rnd() * 26 });
        vtiled(c, ch, () => {
          for (const g of glows) {
            const gr = c.createRadialGradient(g.gx, g.gy, 0, g.gx, g.gy, g.r);
            gr.addColorStop(0, silColor(P.mid, 1.0, 0.12));
            gr.addColorStop(1, silColor(P.mid, 1.0, 0));
            c.fillStyle = gr;
            c.fillRect(g.gx - g.r, g.gy - g.r, g.r * 2, g.r * 2);
          }
          for (const p of plates) {
            c.fillStyle = silColor(P.mid, 0.30, 0.85);
            c.beginPath();
            p.pts.forEach(([px, py], idx) => idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py));
            c.closePath(); c.fill();
            c.strokeStyle = silColor(P.bright, 1.0, 0.5);
            c.lineWidth = 1.8;
            c.beginPath(); c.moveTo(p.edge[0][0], p.edge[0][1]); c.lineTo(p.edge[1][0], p.edge[1][1]); c.stroke();
          }
        });
      },
      spikes: (c, cw, ch, t, rnd, profileX) => {
        const P = t.palette;
        const shards: { sy: number; anchor: number; len: number; halfBase: number; tipDy: number }[] = [];
        for (let i = 0; i < 7; i++) {
          const sy = rnd() * ch;
          const anchor = profileX(sy);
          shards.push({ sy, anchor, len: anchor - 3 - rnd() * cw * 0.05, halfBase: 7 + rnd() * 9, tipDy: (rnd() - 0.5) * 9 });
        }
        vtiled(c, ch, () => {
          for (const s of shards) {
            c.fillStyle = silColor(P.mid, 0.16);
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.lineTo(s.anchor + cw * 0.05, s.sy + s.halfBase);
            c.closePath();
            c.fill();
            c.strokeStyle = silColor(P.bright, 1.0, 0.6);
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(s.anchor + cw * 0.05, s.sy - s.halfBase);
            c.lineTo(s.anchor - s.len, s.sy + s.tipDy);
            c.stroke();
          }
        });
      },
    });
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

  // World 1 far: a deep ember sky with ash cloud bands over two
  // ranges of basalt spires. Rebuilt Oct 28, 2026 (Carter: the old
  // backdrop read as broken: faint spire stripes in a near-empty
  // field). Everything is designed at the scale the game shows
  // (the tile is magnified about 3x on screen): bold jagged
  // polygons with real variation and facet shading, no hairline
  // detail. Shapes are generated once into lists, then drawn at
  // the three wrap offsets, so the horizontal wrap copies are the
  // same shapes (a re-rolled copy is not a copy). The bright
  // accents live in the mid layer and the ground shelf; this
  // layer is sky and silhouette only, and its mid field stays
  // vertically gentle for the scroll seam crossfade.
function paintEmberFar(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(101);
    const P = td.palette;
    const base = h * 0.995;
    // Ash cloud bands: wide, soft, low contrast strata.
    type Band = { cx: number; cy: number; rw: number; rh: number; smoke: boolean; a: number };
    const bands: Band[] = [];
    for (let k = 0; k < 6; k++) {
      bands.push({
        cx: rnd() * w, cy: h * (0.05 + rnd() * 0.52),
        rw: w * (0.30 + rnd() * 0.32), rh: 16 + rnd() * 30,
        smoke: rnd() < 0.45, a: 0.05 + rnd() * 0.05,
      });
    }
    // Spire ranges: back range taller and dimmer, front range
    // bolder. A spire is a jagged polygon: jittered sides rising
    // to a broken two-peak top, some carrying a facet plane.
    type Spire = { pts: [number, number][]; facet: [number, number][] | null };
    const genRange = (tone: string, hMin: number, hMax: number, wMin: number, wMax: number, gMin: number, gMax: number): { tone: string; spires: Spire[] } => {
      const spires: Spire[] = [];
      let x = -40;
      while (x < w + 40) {
        const wid = wMin + rnd() * (wMax - wMin);
        const hgt = h * (hMin + rnd() * (hMax - hMin));
        const top = base - hgt;
        const lean = (rnd() - 0.5) * wid * 0.22;
        const p1x = x + wid * (0.30 + rnd() * 0.14), p1y = top + rnd() * hgt * 0.05;
        const nx = x + wid * (0.48 + rnd() * 0.12), ny = top + hgt * (0.05 + rnd() * 0.07);
        const p2x = x + wid * (0.66 + rnd() * 0.16), p2y = top + rnd() * hgt * 0.06;
        const pts: [number, number][] = [
          [x, base],
          [x + wid * (0.08 + rnd() * 0.10), base - hgt * (0.42 + rnd() * 0.16)],
          [p1x + lean * 0.4, p1y],
          [nx + lean * 0.6, ny],
          [p2x + lean * 0.8, p2y],
          [x + wid * (0.88 + rnd() * 0.08), base - hgt * (0.40 + rnd() * 0.18)],
          [x + wid, base],
        ];
        let facet: [number, number][] | null = null;
        if (rnd() < 0.55) {
          facet = [
            [p1x + lean * 0.4, p1y],
            [nx + lean * 0.6, ny],
            [x + wid * (0.40 + rnd() * 0.10), base - hgt * 0.30],
            [x + wid * (0.26 + rnd() * 0.08), base],
            [x + wid * 0.10, base],
          ];
        }
        spires.push({ pts, facet });
        x += wid + gMin + rnd() * (gMax - gMin);
      }
      return { tone, spires };
    };
    const rangeA = genRange(silColor(P.deep, 0.60), 0.22, 0.55, 22, 56, 4, 40);
    const rangeB = genRange(silColor(P.deep, 0.80), 0.15, 0.40, 18, 48, 12, 64);
    tiled(ctx, w, () => {
      for (const b of bands) {
        ctx.save();
        ctx.translate(b.cx, b.cy);
        ctx.scale(1, b.rh / b.rw);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, b.rw);
        if (b.smoke) {
          g.addColorStop(0, `rgba(0,0,0,${b.a})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
        } else {
          g.addColorStop(0, silColor(P.deep, 0.95, b.a));
          g.addColorStop(1, silColor(P.deep, 0.95, 0));
        }
        ctx.fillStyle = g;
        ctx.fillRect(-b.rw, -b.rw, b.rw * 2, b.rw * 2);
        ctx.restore();
      }
      for (const range of [rangeA, rangeB]) {
        for (const s of range.spires) {
          ctx.fillStyle = range.tone;
          ctx.beginPath();
          s.pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
          ctx.closePath(); ctx.fill();
          if (s.facet) {
            ctx.fillStyle = silColor(P.deep, range === rangeA ? 0.74 : 0.97, 0.55);
            ctx.beginPath();
            s.facet.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
            ctx.closePath(); ctx.fill();
          }
        }
      }
    });
  }

  // World 1 mid: basalt cliff formations with facet shading and
  // lava in the rock, plus jagged debris chunks at their bases.
  // Rebuilt Oct 28, 2026: the old mid painted small dark ellipses
  // with a gold rim arc under each; magnified about 3x by the
  // backdrop plane they read as giant flat discs with smiles.
  // The chunks here are irregular polygons no wider than about
  // 34 canvas px (about 15 percent of the screen at in-game
  // magnification), and no ellipse-plus-arc shape remains. Lava
  // exists only as short cracks descending inside formations
  // and small pools at their bases: nothing horizontal, nothing
  // continuous, nothing in open sky.
function paintEmberMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(102);
    const P = td.palette;
    const base = h * 0.995;
    type Crack = { pts: [number, number][]; pool: number };
    type Formation = {
      pts: [number, number][]; facetL: [number, number][]; facetR: [number, number][];
      cracks: Crack[]; glowX: number; glowR: number;
    };
    const formations: Formation[] = [];
    const genFormation = (x: number, wid: number, hgt: number): Formation => {
      const top = base - hgt;
      // Broken top ridge: 3 to 5 points across, jittered.
      const ridge: [number, number][] = [];
      const nR = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < nR; i++) {
        ridge.push([x + wid * (0.16 + (0.68 * i) / (nR - 1)), top + rnd() * hgt * 0.10]);
      }
      const pts: [number, number][] = [
        [x, base],
        [x + wid * (0.02 + rnd() * 0.05), base - hgt * (0.45 + rnd() * 0.15)],
        [x + wid * (0.10 + rnd() * 0.06), top + hgt * (0.10 + rnd() * 0.10)],
        ...ridge,
        [x + wid * (0.90 + rnd() * 0.05), top + hgt * (0.12 + rnd() * 0.10)],
        [x + wid * (0.97 + rnd() * 0.03), base - hgt * (0.42 + rnd() * 0.16)],
        [x + wid, base],
      ];
      const facetL: [number, number][] = [
        ridge[0],
        [x + wid * (0.44 + rnd() * 0.08), top + hgt * (0.30 + rnd() * 0.14)],
        [x + wid * (0.34 + rnd() * 0.08), base],
        [x + wid * 0.06, base],
        [x + wid * (0.05 + rnd() * 0.04), base - hgt * 0.55],
      ];
      const facetR: [number, number][] = [
        ridge[ridge.length - 1],
        [x + wid * (0.60 + rnd() * 0.08), top + hgt * (0.34 + rnd() * 0.14)],
        [x + wid * (0.70 + rnd() * 0.08), base],
        [x + wid * 0.96, base],
        [x + wid * (0.94 + rnd() * 0.03), base - hgt * 0.50],
      ];
      const cracks: Crack[] = [];
      const nC = 1 + Math.floor(rnd() * 2);
      for (let c = 0; c < nC; c++) {
        let cxp = x + wid * (0.25 + rnd() * 0.5);
        let cyp = top + hgt * (0.08 + rnd() * 0.20);
        const cp: [number, number][] = [[cxp, cyp]];
        const segs = 3 + Math.floor(rnd() * 3);
        for (let sIdx = 0; sIdx < segs; sIdx++) {
          cxp += (rnd() - 0.5) * 26;
          cyp += 13 + rnd() * 15;
          cp.push([cxp, cyp]);
        }
        cracks.push({ pts: cp, pool: base - cyp < 46 ? 11 + rnd() * 9 : 0 });
      }
      return { pts, facetL, facetR, cracks, glowX: x + wid / 2, glowR: wid * (0.5 + rnd() * 0.14) };
    };
    let fx = -30;
    while (fx < w + 30) {
      const wid = 100 + rnd() * 90;
      const hgt = 140 + rnd() * 95;
      formations.push(genFormation(fx, wid, hgt));
      if (rnd() < 0.6) {
        // A shoulder block leaning on the main massif.
        formations.push(genFormation(fx + wid * (0.72 + rnd() * 0.2), 50 + rnd() * 42, 60 + rnd() * 62));
      }
      fx += wid + 26 + rnd() * 88;
    }
    // Debris chunks: jagged polygons, generated once.
    type Chunk = { pts: [number, number][]; facet: [number, number][]; ember: [number, number][] | null };
    const chunks: Chunk[] = [];
    const genChunk = (cx: number, cy: number, r: number): Chunk => {
      const n = 6 + Math.floor(rnd() * 3);
      const rot = rnd() * Math.PI * 2;
      const verts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        const rr = r * (0.65 + rnd() * 0.5);
        verts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82]);
      }
      const facet: [number, number][] = [verts[0], verts[1], verts[2], [cx, cy]];
      const ember: [number, number][] | null = rnd() < 0.45
        ? [verts[Math.floor(n * 0.55)], verts[Math.floor(n * 0.55) + 1] || verts[0]] : null;
      return { pts: verts, facet, ember };
    };
    for (let k = 0; k < 9; k++) chunks.push(genChunk(rnd() * w, h * (0.80 + rnd() * 0.165), 8 + rnd() * 9));
    for (let k = 0; k < 3; k++) chunks.push(genChunk(rnd() * w, h * (0.70 + rnd() * 0.08), 6 + rnd() * 4));
    const trace = (pts: [number, number][]) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
    };
    tiled(ctx, w, () => {
      for (const f of formations) {
        // Heat glow pooled at the formation's base.
        ctx.save();
        ctx.translate(f.glowX, base);
        ctx.scale(1, 20 / f.glowR);
        const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, f.glowR);
        gg.addColorStop(0, silColor(P.mid, 1.0, 0.10));
        gg.addColorStop(1, silColor(P.mid, 1.0, 0));
        ctx.fillStyle = gg;
        ctx.fillRect(-f.glowR, -f.glowR, f.glowR * 2, f.glowR * 2);
        ctx.restore();
        ctx.fillStyle = silColor(P.deep, 0.88);
        trace(f.pts); ctx.fill();
        ctx.fillStyle = silColor(P.deep, 1.04, 0.80);
        trace(f.facetL); ctx.fill();
        ctx.fillStyle = silColor(P.deep, 0.64, 0.80);
        trace(f.facetR); ctx.fill();
        for (const cr of f.cracks) {
          ctx.lineJoin = 'round';
          ctx.strokeStyle = silColor(P.mid, 1.0, 0.30);
          ctx.lineWidth = 6;
          ctx.beginPath();
          cr.pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
          ctx.stroke();
          ctx.strokeStyle = silColor(P.bright, 0.95, 0.80);
          ctx.lineWidth = 2;
          ctx.beginPath();
          cr.pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
          ctx.stroke();
          if (cr.pool > 0) {
            const [ex, ey] = cr.pts[cr.pts.length - 1];
            const pg = ctx.createRadialGradient(ex, ey, 0, ex, ey, cr.pool);
            pg.addColorStop(0, silColor(P.mid, 1.0, 0.35));
            pg.addColorStop(1, silColor(P.mid, 1.0, 0));
            ctx.fillStyle = pg;
            ctx.fillRect(ex - cr.pool, ey - cr.pool, cr.pool * 2, cr.pool * 2);
            ctx.fillStyle = silColor(P.bright, 1.0, 0.6);
            ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      for (const ch of chunks) {
        ctx.fillStyle = silColor(P.deep, 0.95);
        trace(ch.pts); ctx.fill();
        ctx.fillStyle = silColor(P.deep, 1.08, 0.55);
        trace(ch.facet); ctx.fill();
        if (ch.ember) {
          ctx.strokeStyle = silColor(P.mid, 0.9, 0.5);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(ch.ember[0][0], ch.ember[0][1]);
          ctx.lineTo(ch.ember[1][0], ch.ember[1][1]);
          ctx.stroke();
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

  // World 1 ground: a broken basalt shelf, not a lava line.
  // Rebuilt Oct 28, 2026: the old painter drew a thin glowing
  // lava line with pulses as a ground feature of the static
  // scene; once the backdrop scrolled and wrapped, the line
  // floated across open sky at arbitrary heights (Carter's
  // phone screenshots). The shelf is dark rock: a jagged
  // whole-period ridge profile (x-periodic by construction),
  // crags on the ridge, facet shading inside the mass, and a
  // bottom edge that fades out so the stratum dissolves into
  // the scene at any scroll phase. Lava lives only inside the
  // rock: three short trickles running down the face from
  // cracks, small pools where they land, and two short seams
  // on the ridge surface, all broken by long dark gaps. Hard
  // rule kept: no continuous horizontal glowing line anywhere.
function paintGroundLava(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(103);
    const P = td.palette;
    const ridgeY = (x: number) => 36 + 9 * Math.sin((2 * Math.PI * 2 * x) / w + 0.7)
      + 6 * Math.sin((2 * Math.PI * 5 * x) / w + 2.1) + 4 * Math.sin((2 * Math.PI * 11 * x) / w + 4.0);
    // Rock mass below the ridge profile.
    ctx.fillStyle = silColor(P.deep, 0.68);
    ctx.beginPath();
    ctx.moveTo(0, ridgeY(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, ridgeY(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // Crags standing on the ridge.
    for (let k = 0; k < 5; k++) {
      const cx = rnd() * w, cw = 26 + rnd() * 28, ch = 14 + rnd() * 20;
      const ry = ridgeY(cx);
      ctx.fillStyle = silColor(P.deep, 0.68);
      ctx.beginPath();
      ctx.moveTo(cx - cw / 2, ry + 3);
      ctx.lineTo(cx - cw * (0.14 + rnd() * 0.1), ry - ch * (0.55 + rnd() * 0.2));
      ctx.lineTo(cx + cw * (0.02 + rnd() * 0.12), ry - ch);
      ctx.lineTo(cx + cw * (0.24 + rnd() * 0.1), ry - ch * (0.5 + rnd() * 0.2));
      ctx.lineTo(cx + cw / 2, ry + 3);
      ctx.closePath(); ctx.fill();
    }
    // Facet shading inside the mass.
    for (let k = 0; k < 6; k++) {
      const fx = rnd() * w, fy = ridgeY(fx) + 14 + rnd() * (h * 0.4);
      const fw = 40 + rnd() * 70, fh = 12 + rnd() * 20;
      ctx.fillStyle = silColor(P.deep, rnd() < 0.5 ? 0.50 : 0.85, 0.55);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + fw, fy + (rnd() - 0.5) * 8);
      ctx.lineTo(fx + fw * (0.7 + rnd() * 0.3), fy + fh);
      ctx.lineTo(fx + fw * (0.1 + rnd() * 0.2), fy + fh * (0.8 + rnd() * 0.3));
      ctx.closePath(); ctx.fill();
    }
    // Lava trickles: short flows down the rock face from cracks,
    // each ending in a small pool. Vertical, broken, sparse.
    for (let k = 0; k < 3; k++) {
      let tx = rnd() * w;
      let ty = ridgeY(tx) + 2;
      const pts: [number, number][] = [[tx, ty]];
      const segs = 3 + Math.floor(rnd() * 2);
      for (let s = 0; s < segs; s++) {
        tx += (rnd() - 0.5) * 12;
        ty += 9 + rnd() * 8;
        pts.push([tx, ty]);
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = silColor(P.mid, 1.0, 0.28);
      ctx.lineWidth = 5;
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.stroke();
      ctx.strokeStyle = silColor(P.bright, 0.95, 0.75);
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.stroke();
      const [ex, ey] = pts[pts.length - 1];
      const pr = 9 + rnd() * 5;
      const pg = ctx.createRadialGradient(ex, ey, 0, ex, ey, pr);
      pg.addColorStop(0, silColor(P.mid, 1.0, 0.32));
      pg.addColorStop(1, silColor(P.mid, 1.0, 0));
      ctx.fillStyle = pg;
      ctx.fillRect(ex - pr, ey - pr, pr * 2, pr * 2);
    }
    // Two short seams glowing on the ridge surface itself.
    for (let k = 0; k < 2; k++) {
      const sx = rnd() * w, len = 15 + rnd() * 9;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = silColor(P.mid, 1.0, 0.25);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sx, ridgeY(sx));
      ctx.lineTo(sx + len * 0.5, ridgeY(sx + len * 0.5) + 1);
      ctx.lineTo(sx + len, ridgeY(sx + len));
      ctx.stroke();
      ctx.strokeStyle = silColor(P.bright, 0.95, 0.65);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, ridgeY(sx));
      ctx.lineTo(sx + len * 0.5, ridgeY(sx + len * 0.5) + 1);
      ctx.lineTo(sx + len, ridgeY(sx + len));
      ctx.stroke();
    }
    // The shelf's bottom edge dissolves into the scene.
    const fade = ctx.createLinearGradient(0, h * 0.45, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, h * 0.45, w, h * 0.55);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Scrolling-ground law (Worlds 2 to 10 pass, from the World 1
  // shelf redo): once a world's backdrop scrolls, its ground
  // strip wraps through the whole field, so the strip must read
  // as a stratum of the scene at any phase, never as a floating
  // band. Every ground painter below therefore fades its bottom
  // edge out inside its own canvas (this helper, the same curve
  // the World 1 shelf uses), keeps any glow broken into short
  // segments or points with dark gaps between them, and never
  // draws a continuous horizontal glowing line.
function fadeGroundBottom(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const fade = ctx.createLinearGradient(0, h * 0.45, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, h * 0.45, w, h * 0.55);
    ctx.restore();
  }

  // Broken reflection segments along a ground strip's top edge:
  // short gradient streaks in the world's mid color, each fading
  // downward, separated by dark gaps at least as long as the
  // streaks. The shared replacement for the old full-width
  // horizon streaks (Mirror, Crystal, Ice), which read as
  // glowing lines floating across the sky once the backdrop
  // scrolled.
function brokenReflection(ctx: CanvasRenderingContext2D, w: number, rnd: () => number, topY: (x: number) => number, rgb: Rgb3, alpha: number, count: number) {
    for (let k = 0; k < count; k++) {
      const sx = rnd() * w, len = 36 + rnd() * 84, sy = topY(sx) + 2;
      const grad = ctx.createLinearGradient(0, sy, 0, sy + 15);
      grad.addColorStop(0, silColor(rgb, 1.0, alpha));
      grad.addColorStop(1, silColor(rgb, 1.0, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(sx, sy, len, 15);
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
    fadeGroundBottom(ctx, w, h);
  }

  // World 3 ground: a fractured mirror plane, shimmer only.
  // Rebuilt for the scrolling pass: the plane's near edge is a
  // jagged crack profile instead of a flat rect edge, and the
  // horizon reflection is broken into short segments with dark
  // gaps (the old full-width streak read as a glowing line
  // floating in the sky once the backdrop scrolled).
function paintGroundMirror(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(303);
    const topY = (x: number) => 22 + 4 * Math.sin((2 * Math.PI * 3 * x) / w + 1.3) + 3 * Math.sin((2 * Math.PI * 7 * x) / w + 0.5);
    ctx.fillStyle = silColor(td.palette.deep, 0.30);
    ctx.beginPath();
    ctx.moveTo(0, topY(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, topY(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The horizon reflection, broken into segments.
    brokenReflection(ctx, w, rnd, topY, td.palette.mid, 0.16, 6);
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
    fadeGroundBottom(ctx, w, h);
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
    // Dark floor mass under a wavy leaf-litter top profile (the
    // scrolling pass: a flat rect edge would read as a band edge
    // floating across the field once the backdrop wraps).
    const topY = (x: number) => 24 + 5 * Math.sin((2 * Math.PI * 2 * x) / w + 0.9) + 3 * Math.sin((2 * Math.PI * 6 * x) / w + 2.2);
    const grad = ctx.createLinearGradient(0, 20, 0, h);
    grad.addColorStop(0, silColor(td.palette.deep, 0.30));
    grad.addColorStop(1, silColor(td.palette.deep, 0.48));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, topY(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, topY(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
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
    fadeGroundBottom(ctx, w, h);
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

  // World 5 mid: tumbling ash rocks, gray on gray, a dull rim
  // along the upper edges. Rebuilt in the Worlds 2 to 10 pass:
  // the old version painted ellipse boulders with a rim arc,
  // the Ember boulders' shape language, which the World 1 redo
  // bars (at in-game magnification they read as flat discs).
  // The rocks are jagged polygons now, generated once and drawn
  // identically at every wrap offset.
function paintAshenMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(504);
    const fill = silColor(td.palette.deep, 0.62);
    const facetFill = silColor(td.palette.deep, 0.82, 0.55);
    const rim = silColor(td.palette.mid, 1.0, 0.30);
    type Rock = { pts: [number, number][]; facet: [number, number][]; rimPts: [number, number][] };
    const rocks: Rock[] = [];
    for (let k = 0; k < 11; k++) {
      const cx = rnd() * w, cy = h * (0.14 + rnd() * 0.6);
      const R = 13 + rnd() * 24, rot = rnd() * Math.PI * 2;
      const n = 6 + Math.floor(rnd() * 3);
      const pts: [number, number][] = [];
      for (let v = 0; v < n; v++) {
        const a = rot + (v / n) * Math.PI * 2;
        const rr = R * (0.62 + rnd() * 0.5);
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.72]);
      }
      let topIdx = 0;
      for (let v = 1; v < n; v++) if (pts[v][1] < pts[topIdx][1]) topIdx = v;
      rocks.push({
        pts,
        facet: [pts[topIdx], pts[(topIdx + 1) % n], [cx, cy]],
        rimPts: [pts[(topIdx + n - 1) % n], pts[topIdx], pts[(topIdx + 1) % n]],
      });
    }
    tiled(ctx, w, () => {
      for (const r of rocks) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        r.pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = facetFill;
        ctx.beginPath();
        r.facet.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rim; ctx.lineWidth = 2.5;
        ctx.beginPath();
        r.rimPts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.stroke();
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
    fadeGroundBottom(ctx, w, h);
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

  // World 6 ground: a reflective crystal floor (sheet): facet
  // lines and dim mirrored glows below a broken horizon
  // reflection. Rebuilt for the scrolling pass like the Mirror
  // plane: jagged top profile, the reflection in short segments
  // with dark gaps instead of one full-width streak, and the
  // bottom edge faded out.
function paintGroundCrystal(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(603);
    const topY = (x: number) => 21 + 4 * Math.sin((2 * Math.PI * 4 * x) / w + 0.4) + 3 * Math.sin((2 * Math.PI * 9 * x) / w + 1.9);
    ctx.fillStyle = silColor(td.palette.deep, 0.34);
    ctx.beginPath();
    ctx.moveTo(0, topY(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, topY(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The horizon reflection, broken into segments.
    brokenReflection(ctx, w, rnd, topY, td.palette.mid, 0.20, 6);
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
    fadeGroundBottom(ctx, w, h);
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
    // Nebula clouds: clusters of soft gradient puffs, dark gas
    // with a faint magenta glow offset to the lit side. Rebuilt
    // in the Worlds 2 to 10 pass: the old hard-edged ellipses
    // with a rim arc were the ellipse-plus-arc shape the World 1
    // redo bars. Generated once, drawn at every wrap offset.
    type Puff = { cx: number; cy: number; rx: number; ry: number };
    const puffs: Puff[] = [];
    const rimPuffs: Puff[] = [];
    for (let c = 0; c < 6; c++) {
      const ccx = rnd() * w, ccy = h * (0.30 + rnd() * 0.5);
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const rx = 34 + rnd() * 62;
        const p: Puff = { cx: ccx + (rnd() - 0.5) * 120, cy: ccy + (rnd() - 0.5) * 42, rx, ry: rx * (0.30 + rnd() * 0.16) };
        puffs.push(p);
        rimPuffs.push({ cx: p.cx - rx * 0.18, cy: p.cy - p.ry * 0.55, rx: rx * 0.8, ry: p.ry * 0.8 });
      }
    }
    const drawPuff = (p: Puff, rgb: Rgb3, f: number, a: number) => {
      ctx.save();
      ctx.translate(p.cx, p.cy);
      ctx.scale(1, p.ry / p.rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
      g.addColorStop(0, silColor(rgb, f, a));
      g.addColorStop(1, silColor(rgb, f, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-p.rx, -p.rx, p.rx * 2, p.rx * 2);
      ctx.restore();
    };
    tiled(ctx, w, () => {
      for (const p of puffs) drawPuff(p, td.palette.deep, 0.42, 0.85);
      for (const p of rimPuffs) drawPuff(p, td.palette.mid, 1.0, 0.13);
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
  // reflected in it: crack lines in pale ice and dim mirrored
  // glow pools. Rebuilt for the scrolling pass: the plain's top
  // edge is a jagged frost profile, and the two-tone aurora
  // reflection (magenta and teal) is broken into short segments
  // with dark gaps instead of two full-width washes, which read
  // as glowing bands once the backdrop scrolled.
function paintGroundIce(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(703);
    const teal = td.sky.secondaryGlow ?? [0.0, 0.9, 0.8];
    const topY = (x: number) => 21 + 4 * Math.sin((2 * Math.PI * 3 * x) / w + 2.6) + 3 * Math.sin((2 * Math.PI * 8 * x) / w + 0.8);
    ctx.fillStyle = silColor(td.palette.deep, 0.34);
    ctx.beginPath();
    ctx.moveTo(0, topY(0));
    for (let x = 8; x <= w; x += 8) ctx.lineTo(x, topY(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The aurora reflection, broken into segments, the two
    // tones interleaved along the edge.
    for (let k = 0; k < 7; k++) {
      const sx = rnd() * w, len = 40 + rnd() * 80, sy = topY(sx) + 2;
      const rgb = k % 2 === 0 ? td.palette.mid : teal;
      const grad = ctx.createLinearGradient(0, sy, 0, sy + 16);
      grad.addColorStop(0, silColor(rgb, 1.0, k % 2 === 0 ? 0.15 : 0.13));
      grad.addColorStop(1, silColor(rgb, 1.0, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(sx, sy, len, 16);
    }
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
    fadeGroundBottom(ctx, w, h);
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

  // World 8 mid: wind-blown sand streaks and tumbling shards
  // of pottery-bright stone. The streaks are broken chains of
  // feathered puffs (radial gradients, no hard edge): the old
  // version drew very flat filled ellipses (rx up to 260, ry
  // 3 to 9) in the bright band, and at the backdrop plane's
  // magnification each one became a hard-edged horizontal band
  // spanning the screen at an arbitrary height, the exact
  // failure the World 1 redo banned. A puff chain has no
  // continuous edge and no full-width span at any phase.
function paintSandsMid(ctx: CanvasRenderingContext2D, w: number, h: number, td: WorldTheme) {
    const rnd = themeRng(802);
    tiled(ctx, w, () => {
      // Sand streaks: 2 to 4 soft puffs along a slight slope,
      // with gaps, in the palette's bright band at low alpha so
      // they read as lit dust drifting, not fog banks.
      for (let k = 0; k < 9; k++) {
        const sx = rnd() * w, sy = h * (0.10 + rnd() * 0.72);
        const slope = (rnd() - 0.5) * 0.35;
        const puffs = 2 + Math.floor(rnd() * 3);
        for (let p = 0; p < puffs; p++) {
          const cx = sx + p * (34 + rnd() * 30), cy = sy + slope * (cx - sx);
          const rx = 26 + rnd() * 40, ry = rx * (0.16 + rnd() * 0.08);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
          const a = 0.05 + rnd() * 0.04;
          g.addColorStop(0, silColor(td.palette.bright, 1.0, a));
          g.addColorStop(1, silColor(td.palette.bright, 1.0, 0));
          ctx.save();
          ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(cx, cy, rx, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
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
    grad2.addColorStop(0, silColor(td.palette.deep, 0.46));
    grad2.addColorStop(1, silColor(td.palette.deep, 0.28));
    ctx.fillStyle = grad2;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 16; x <= w; x += 16) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.fill();
    // The ridge line, sunlit in BROKEN segments: a continuous
    // full-width stroke read as a floating glowing line when
    // the ground strip transited the screen (the World 1 redo
    // rule). Seeded runs of 14 to 34 px with 10 to 24 px gaps,
    // alpha varying, so the light sits on the ridge in patches
    // the way sun catches a dune crest.
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    let sx = 0;
    while (sx < w) {
      const run = 14 + rnd() * 20, gap = 10 + rnd() * 14;
      ctx.strokeStyle = silColor(td.palette.mid, 1.0, 0.3 + rnd() * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx, yAt(sx));
      for (let x = sx + 4; x <= Math.min(w, sx + run); x += 4) ctx.lineTo(x, yAt(x));
      ctx.stroke();
      sx += run + gap;
    }
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
    fadeGroundBottom(ctx, w, h);
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
  // broken red segments along its crest.
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
    // The moon's reflection riding the crest, broken into
    // segments with dark gaps (the scrolling pass: one
    // continuous glowing line across the whole strip is the
    // shape the World 1 redo removed; a reflection on a rough
    // crest breaks naturally). Segment placement is seeded so
    // the strip is the same every visit.
    const rnd = themeRng(904);
    ctx.strokeStyle = silColor(td.palette.bright, 1.0, 0.55);
    ctx.lineWidth = 2;
    ctx.shadowColor = silColor(td.palette.bright, 1.0, 0.7);
    ctx.shadowBlur = 8;
    let sx = rnd() * 30;
    while (sx < w) {
      const len = 34 + rnd() * 60;
      ctx.beginPath();
      ctx.moveTo(sx, yAt(sx));
      for (let x = sx + 8; x <= Math.min(w, sx + len); x += 8) ctx.lineTo(x, yAt(x));
      ctx.stroke();
      sx += len + 40 + rnd() * 70;
    }
    ctx.shadowBlur = 0;
    fadeGroundBottom(ctx, w, h);
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
