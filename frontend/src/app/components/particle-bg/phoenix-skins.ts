// Phoenix skin records and world-to-skin resolution (visual spec
// Section 2.4 and the Oct 25, 2026 addendum: skins are automatic per
// world, no picker). Moved out of particle-bg.component.ts in the
// code organization pass (Oct 27, 2026); values unchanged.
import { WORLDS } from '../../constants/game.constants';

// ---------------------------------------------------------------------------
// Phoenix skins (visual spec Section 2.4). A skin is a restyle record:
// palette, glyph edge treatment, glow, and trail style only. It never
// changes silhouette proportions, wingspan, animation timing, brightness
// rank, or collision (collision lives in the game component and never
// reads anything here). The particle silhouette and the wingspan are
// identical for every skin; the glyph edge treatments live in the core
// sprite, drawn inside the same bounding box for every skin.
// ---------------------------------------------------------------------------
export type Rgb3 = [number, number, number];
export interface PhoenixSkin {
  id: string;
  name: string;
  bright: Rgb3; mid: Rgb3; deep: Rgb3;
  glyph: { crest: 'tuft' | 'spikes' | 'swept' | 'rays' | 'leaf' | 'crown'; angular: boolean; serrated: boolean; darkHeart: boolean; facets: boolean; sparkles: boolean; broadWings: boolean };
  glowSpan: number; // multiple of wingspan (round 1 default is 1.35)
  glowRing: 'none' | 'eclipse' | 'halo';
  trailStyle: 'ember' | 'snow' | 'eclipse' | 'ribbon' | 'pollen' | 'sequence';
  trailA: Rgb3 | null; trailB: Rgb3 | null; // alternating tail spark colors (Celestial)
  flickerScale: number; // fill-point sampling jitter scale (Frost facets sit stiller)
}

export const PHOENIX_SKINS: PhoenixSkin[] = [
  { id: 'ember', name: 'Ember', bright: [1.0, 0.8, 0.2], mid: [1.0, 0.4, 0.0], deep: [0.8, 0.1, 0.0],
    glyph: { crest: 'tuft', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: false, broadWings: false },
    glowSpan: 1.35, glowRing: 'none', trailStyle: 'ember', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'frost', name: 'Frost', bright: [0.85, 0.98, 1.0], mid: [0.35, 0.65, 1.0], deep: [0.05, 0.2, 0.65],
    glyph: { crest: 'spikes', angular: true, serrated: false, darkHeart: false, facets: true, sparkles: false, broadWings: false },
    glowSpan: 1.35, glowRing: 'none', trailStyle: 'snow', trailA: null, trailB: null, flickerScale: 0.35 },
  { id: 'eclipse', name: 'Eclipse', bright: [0.92, 0.85, 1.0], mid: [0.55, 0.3, 0.95], deep: [0.12, 0.05, 0.25],
    glyph: { crest: 'swept', angular: false, serrated: false, darkHeart: true, facets: false, sparkles: false, broadWings: false },
    glowSpan: 1.4, glowRing: 'eclipse', trailStyle: 'eclipse', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'solar', name: 'Solar', bright: [1.0, 0.95, 0.75], mid: [1.0, 0.8, 0.2], deep: [0.85, 0.55, 0.05],
    glyph: { crest: 'rays', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: false, broadWings: true },
    glowSpan: 1.5, glowRing: 'none', trailStyle: 'ribbon', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'verdant', name: 'Verdant', bright: [0.7, 1.0, 0.3], mid: [0.15, 0.8, 0.25], deep: [0.02, 0.35, 0.08],
    glyph: { crest: 'leaf', angular: false, serrated: true, darkHeart: false, facets: false, sparkles: false, broadWings: false },
    glowSpan: 1.35, glowRing: 'none', trailStyle: 'pollen', trailA: null, trailB: null, flickerScale: 0.7 },
  { id: 'celestial', name: 'Celestial', bright: [1.0, 1.0, 1.0], mid: [0.45, 0.8, 1.0], deep: [0.1, 0.25, 0.75],
    glyph: { crest: 'crown', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: true, broadWings: false },
    glowSpan: 1.45, glowRing: 'halo', trailStyle: 'sequence', trailA: [0.55, 0.95, 1.0], trailB: [1.0, 0.85, 0.35], flickerScale: 1.0 },
];

// The battle rival bird: the master design in the hostile palette, as
// today (static crimson). Rival birds never use player skins (spec 2.4).
export const HOSTILE_SKIN: PhoenixSkin = {
  id: 'hostile', name: 'Hostile', bright: [1.0, 0.3, 0.3], mid: [0.8, 0.0, 0.0], deep: [0.5, 0.0, 0.0],
  glyph: { crest: 'tuft', angular: false, serrated: false, darkHeart: false, facets: false, sparkles: false, broadWings: false },
  glowSpan: 1.35, glowRing: 'none', trailStyle: 'ember', trailA: null, trailB: null, flickerScale: 1.0,
};

export function phoenixSkinById(id: string): PhoenixSkin {
  return PHOENIX_SKINS.find(s => s.id === id) || PHOENIX_SKINS[0];
}

// The player bird's skin is derived from the world being played
// (visual spec addendum, Oct 25, 2026): each WORLDS entry carries the
// skinId it assigns, and there is no player selection or stored state
// anywhere. The menu bird and the Battle player bird read the same
// derivation from the menu-selected world; the rival never does.
export function phoenixSkinForWorld(worldIndex: number): PhoenixSkin {
  const world = WORLDS[Math.max(0, Math.min(WORLDS.length - 1, worldIndex))];
  return phoenixSkinById(world ? world.skinId : 'ember');
}

// Battle mini bosses (the per-realm rivals). Each realm's rival is a
// distinct hostile phoenix: its own palette, crest, wing cut, glow
// treatment and trail. The shared HOSTILE_SKIN record is re-pointed to
// the realm's rival (setRivalSkinForWorld) so every renderer path that
// reads HOSTILE_SKIN draws the current rival without extra plumbing.
const g = (crest: PhoenixSkin['glyph']['crest'], o: Partial<PhoenixSkin['glyph']> = {}): PhoenixSkin['glyph'] =>
  ({ crest, angular: false, serrated: false, darkHeart: false, facets: false, sparkles: false, broadWings: false, ...o });
export const RIVAL_SKINS: PhoenixSkin[] = [
  { id: 'rival_0', name: 'Slag Brute', bright: [1.0, 0.55, 0.2], mid: [0.75, 0.12, 0.02], deep: [0.25, 0.06, 0.04],
    glyph: g('spikes', { serrated: true, broadWings: true }), glowSpan: 1.45, glowRing: 'none', trailStyle: 'ember', trailA: null, trailB: null, flickerScale: 1.2 },
  { id: 'rival_1', name: 'Umbral Stalker', bright: [0.75, 0.45, 1.0], mid: [0.3, 0.08, 0.55], deep: [0.06, 0.02, 0.14],
    glyph: g('swept', { darkHeart: true, angular: true }), glowSpan: 1.35, glowRing: 'eclipse', trailStyle: 'eclipse', trailA: null, trailB: null, flickerScale: 0.8 },
  { id: 'rival_2', name: 'Prism Warden', bright: [0.95, 1.0, 1.0], mid: [0.95, 0.35, 0.85], deep: [0.2, 0.3, 0.6],
    glyph: g('spikes', { facets: true, angular: true, sparkles: true }), glowSpan: 1.4, glowRing: 'halo', trailStyle: 'sequence', trailA: [1.0, 0.5, 0.9], trailB: [0.5, 0.95, 1.0], flickerScale: 0.35 },
  { id: 'rival_3', name: 'Gale Harrier', bright: [1.0, 1.0, 0.6], mid: [0.35, 0.6, 0.95], deep: [0.1, 0.15, 0.4],
    glyph: g('swept', { angular: true, serrated: true }), glowSpan: 1.3, glowRing: 'none', trailStyle: 'ribbon', trailA: null, trailB: null, flickerScale: 1.4 },
  { id: 'rival_4', name: 'Grave Lantern', bright: [0.55, 1.0, 0.75], mid: [0.15, 0.45, 0.35], deep: [0.04, 0.08, 0.08],
    glyph: g('tuft', { darkHeart: true }), glowSpan: 1.5, glowRing: 'halo', trailStyle: 'snow', trailA: null, trailB: null, flickerScale: 0.6 },
  { id: 'rival_5', name: 'Sun Herald', bright: [1.0, 0.95, 0.6], mid: [1.0, 0.55, 0.05], deep: [0.6, 0.15, 0.02],
    glyph: g('rays', { broadWings: true, sparkles: true }), glowSpan: 1.55, glowRing: 'halo', trailStyle: 'ribbon', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'rival_6', name: 'Rime Seer', bright: [0.9, 1.0, 1.0], mid: [0.45, 0.75, 1.0], deep: [0.1, 0.2, 0.5],
    glyph: g('crown', { facets: true, angular: true }), glowSpan: 1.4, glowRing: 'none', trailStyle: 'snow', trailA: null, trailB: null, flickerScale: 0.3 },
  { id: 'rival_7', name: 'Wyrm Knight', bright: [1.0, 0.7, 0.25], mid: [0.2, 0.5, 0.25], deep: [0.05, 0.18, 0.08],
    glyph: g('spikes', { serrated: true, broadWings: true }), glowSpan: 1.45, glowRing: 'none', trailStyle: 'ember', trailA: null, trailB: null, flickerScale: 1.0 },
  { id: 'rival_8', name: 'Flux Golem', bright: [0.6, 1.0, 0.9], mid: [0.9, 0.15, 0.4], deep: [0.2, 0.04, 0.25],
    glyph: g('leaf', { facets: true, darkHeart: true }), glowSpan: 1.5, glowRing: 'eclipse', trailStyle: 'sequence', trailA: [1.0, 0.3, 0.5], trailB: [0.5, 1.0, 0.9], flickerScale: 1.6 },
  { id: 'rival_9', name: 'Ashborn Rival', bright: [1.0, 1.0, 0.85], mid: [0.95, 0.3, 0.1], deep: [0.15, 0.08, 0.08],
    glyph: g('crown', { broadWings: true, sparkles: true, serrated: true }), glowSpan: 1.6, glowRing: 'halo', trailStyle: 'sequence', trailA: [1.0, 0.85, 0.35], trailB: [1.0, 0.35, 0.1], flickerScale: 1.1 },
];

export function setRivalSkinForWorld(worldIndex: number): PhoenixSkin {
  const w = Math.max(0, Math.min(RIVAL_SKINS.length - 1, worldIndex | 0));
  Object.assign(HOSTILE_SKIN, RIVAL_SKINS[w]);
  return HOSTILE_SKIN;
}
