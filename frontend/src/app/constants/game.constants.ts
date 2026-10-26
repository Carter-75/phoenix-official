import { Rgb, World, WorldStats } from '../models/game.models';

// Shared hostile color (visual spec Section 1.5): enemy intent is always
// the magenta-red family, in every world, never toward a player skin color.
// Exported so renderers without a world context (codex previews) read the
// same data instead of restating the value.
export const HOSTILE_RGB: Rgb = [1.0, 0.18, 0.42];

// World names here are canonical everywhere (menu, codex, shop). The
// Temp-phoenix realm names are retired as display names; their one-line
// descriptions live in data/temp-catalog.ts and are matched to these
// worlds by boss identity. themeData values come from the visual spec
// (DESIGN-OVERHAUL.md Section 4 theme sheets); Stage 0 is data only and
// no renderer reads themeData yet.
//
// Each world's skinId is the phoenix skin the player bird wears in
// that world (visual spec addendum, Oct 25, 2026: skins are automatic
// per world, with no player selection and no stored state). Mapping:
// Ember Wastes Ember, Cerulean Depths Frost, Amethyst Void Eclipse,
// Verdant Canopy Verdant, Ashen Peaks Eclipse, Crystal Caverns Solar,
// Neon Nebula Celestial, Golden Sands Solar, Blood Moon Eclipse,
// Abyssal Rift Celestial.
export const WORLDS: World[] = [
  { id: 0, name: 'Ember Wastes', theme: 'orange', textColorClass: 'from-orange-400 to-red-600', bossName: 'Inferno Guardian', bossTheme: 'Fire', skinId: 'ember',
    themeData: {
      palette: { bright: [1.0, 0.8, 0.2], mid: [1.0, 0.4, 0.0], deep: [0.8, 0.1, 0.0], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [1.0, 0.4, 0.0], intensity: 1.0, position: 'low', secondaryGlow: null, description: 'Deep charcoal sky with the orange glow plane low and strong, like heat over a forge floor. The reference world; the palette is unchanged from the shipped game.' },
      parallaxFar: { motifs: ['black basalt spires', 'broken arches'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['drifting slag boulders, rim-lit orange from below'], scrollFactor: 0.12 },
      atmosphere: { kind: 'rising embers', direction: 'rising', speed: 'slow', density: 'sparse', description: 'Rising embers, sparse and slow.' },
      ground: { band: 'lava glow line', description: 'A lava glow line with slow pulses traveling along it.' },
      enemyVariants: [],
      uiAccent: 'from-orange-400 to-red-600',
    } },
  { id: 1, name: 'Cerulean Depths', theme: 'blue', textColorClass: 'from-blue-400 to-cyan-600', bossName: 'Shadow Lord', bossTheme: 'Dark', skinId: 'frost',
    themeData: {
      palette: { bright: [0.2, 0.8, 1.0], mid: [0.0, 0.4, 1.0], deep: [0.0, 0.1, 0.8], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.0, 0.4, 1.0], intensity: 0.35, position: 'top', secondaryGlow: null, description: 'The darkest blue sky of any world; the glow plane becomes a faint surface shimmer at the top edge, so the player feels submerged, flying down into dark water lit from above.' },
      parallaxFar: { motifs: ['sunken pillars', 'a ruined gate'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['slow jellyfish silhouettes (dark bells with trailing ribbons) drifting up'], scrollFactor: 0.12 },
      atmosphere: { kind: 'rising bubbles and marine snow', direction: 'rising', speed: 'slow', density: 'sparse', description: 'Rising bubbles and marine snow, slow and sparse; occasional bubble streams from the bottom edge.' },
      ground: { band: 'abyssal vent glow', description: 'Abyssal dark with faint blue vent glows.' },
      enemyVariants: [
        { baseType: 'Glob', name: 'Bubble Glob', tweak: 'Membrane pale blue, core visible like an air bubble, surface points shimmer.' },
        { baseType: 'Gloomwing', name: 'Deepwing', tweak: 'Navy body, bioluminescent teal eye and wingtip accents.' },
        { baseType: 'Bastion Golem', name: 'Reef Golem', tweak: 'Rocks darker, core teal.' },
      ],
      uiAccent: 'from-blue-400 to-cyan-600',
    } },
  { id: 2, name: 'Amethyst Void', theme: 'purple', textColorClass: 'from-purple-400 to-fuchsia-600', bossName: 'Crystal Titan', bossTheme: 'Crystal', skinId: 'eclipse',
    themeData: {
      palette: { bright: [0.6, 0.0, 1.0], mid: [0.3, 0.0, 0.8], deep: [0.1, 0.0, 0.5], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.3, 0.0, 0.8], intensity: 0.6, position: 'center', secondaryGlow: [0.6, 0.0, 1.0], description: 'Near-black violet with a slow nebula swirl in the glow plane: two offset glows rotating against each other.' },
      parallaxFar: { motifs: ['giant floating crystal shards, slowly rotating'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['smaller shard clusters drifting past, facets catching the mid color'], scrollFactor: 0.12 },
      atmosphere: { kind: 'suspended crystal dust', direction: 'suspended', speed: 'slow', density: 'sparse', description: 'Suspended crystal dust, almost still, twinkling.' },
      ground: { band: 'fractured mirror plane', description: 'A fractured mirror plane: the horizon reflects the glow in broken facets, shimmer only.' },
      enemyVariants: [
        { baseType: 'Gloomwing', name: 'Voidwing', tweak: 'Purple-black body, violet accents.' },
        { baseType: 'Glob', name: 'Crystal Glob', tweak: 'Membrane amethyst, core a hard bright geode center.' },
      ],
      uiAccent: 'from-purple-400 to-fuchsia-600',
    } },
  { id: 3, name: 'Verdant Canopy', theme: 'green', textColorClass: 'from-green-400 to-emerald-600', bossName: 'Storm Wyvern', bossTheme: 'Lightning', skinId: 'verdant',
    themeData: {
      palette: { bright: [0.2, 1.0, 0.4], mid: [0.0, 0.8, 0.2], deep: [0.0, 0.4, 0.1], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.0, 0.8, 0.2], intensity: 0.5, position: 'top', secondaryGlow: null, description: 'Deep green dark, with god-ray shafts (two or three soft additive wedges from the top) that drift slowly.' },
      parallaxFar: { motifs: ['layered canopy silhouettes', 'hanging vines'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['giant leaves drifting past, rotating slowly, dark with a bright rim on one edge'], scrollFactor: 0.12 },
      atmosphere: { kind: 'spores and pollen', direction: 'rising', speed: 'slow', density: 'moderate', description: 'Spores and pollen rising on warm air, plus occasional drifting seeds (larger, slow, clearly dimmer than pickups).' },
      ground: { band: 'shadowed forest floor', description: 'Shadowed forest floor with shafts of light pooling.' },
      enemyVariants: [
        { baseType: 'Seedmother', name: 'Thornmother', tweak: 'Dome body thorned; lays Thorn Mines (the Rift Mine in green and brown with a root tangle).' },
        { baseType: 'Gloomwing', name: 'Canopy Gloomwing', tweak: 'Green-black body, gold accents.' },
        { baseType: 'Glob', name: 'Moss Glob', tweak: 'Membrane mossy green, core pale.' },
        { baseType: 'Cinder Imp', name: 'Storm Sprite', tweak: 'Guest appearance; palette shifted electric green-white.' },
      ],
      uiAccent: 'from-green-400 to-emerald-600',
    } },
  { id: 4, name: 'Ashen Peaks', theme: 'gray', textColorClass: 'from-gray-300 to-gray-600', bossName: 'Void Reaper', bossTheme: 'Void', skinId: 'eclipse',
    themeData: {
      palette: { bright: [0.9, 0.9, 0.9], mid: [0.5, 0.5, 0.5], deep: [0.2, 0.2, 0.2], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.5, 0.5, 0.5], intensity: 0.05, position: 'center', secondaryGlow: null, description: 'Flat ash gray-black, glow plane almost extinguished (intensity 0.05), so silhouettes carry everything. The one deliberately desaturated world.' },
      parallaxFar: { motifs: ['jagged peak silhouettes in three gray layers'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['tumbling ash boulders'], scrollFactor: 0.12 },
      atmosphere: { kind: 'falling ash', direction: 'falling', speed: 'slow', density: 'dense', description: 'Falling ash, dense by this game standards (density from smaller points, not more), drifting sideways with a slow wind sine.' },
      ground: { band: 'snow-ash ridge line', description: 'A snow-ash ridge line with the glow of the player reflecting faintly.' },
      enemyVariants: [
        { baseType: 'Bastion Golem', name: 'Ash Golem', tweak: 'Rocks pale gray, core dull ember.' },
        { baseType: 'Gloomwing', name: 'Ashwing', tweak: 'Gray body, ember eye.' },
      ],
      uiAccent: 'from-gray-300 to-gray-600',
    } },
  { id: 5, name: 'Crystal Caverns', theme: 'cyan', textColorClass: 'from-cyan-300 to-blue-500', bossName: 'Phoenix King', bossTheme: 'Holy Fire', skinId: 'solar',
    themeData: {
      palette: { bright: [0.4, 1.0, 1.0], mid: [0.0, 0.8, 1.0], deep: [0.0, 0.5, 0.8], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.0, 0.8, 1.0], intensity: 0.6, position: 'top', secondaryGlow: null, description: 'Cave dark with light shafts from crystal clusters above; the glow plane is cool and calm. The light returning after Ashen Peaks.' },
      parallaxFar: { motifs: ['cathedral crystal formations'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['hanging crystal clusters that pulse slowly as the player passes (cosmetic only)'], scrollFactor: 0.12 },
      atmosphere: { kind: 'fine crystal dust', direction: 'falling', speed: 'slow', density: 'sparse', description: 'Fine crystal dust falling slowly, sparkling.' },
      ground: { band: 'reflective crystal floor', description: 'A reflective crystal floor band with the glow of the player mirrored dimly.' },
      enemyVariants: [
        { baseType: 'Sentry Shard', name: 'Prism Shard', tweak: 'Brighter facets, core white.' },
        { baseType: 'Shieldback', name: 'Crystalback', tweak: 'Shield face is a crystal plate.' },
        { baseType: 'Brood Pod', name: 'Geode Pod', tweak: 'Rocky shell, crystal cells.' },
      ],
      uiAccent: 'from-cyan-300 to-blue-500',
    } },
  { id: 6, name: 'Neon Nebula', theme: 'magenta', textColorClass: 'from-fuchsia-400 to-pink-600', bossName: 'Ice Empress', bossTheme: 'Ice', skinId: 'celestial',
    themeData: {
      palette: { bright: [1.0, 0.4, 1.0], mid: [0.8, 0.0, 0.8], deep: [0.5, 0.0, 0.5], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.8, 0.0, 0.8], intensity: 0.8, position: 'top', secondaryGlow: [0.0, 0.9, 0.8], description: 'The most colorful sky in the game: two glow planes (magenta, teal) as a slow aurora curtain across the top third. A frozen nebula; ice identity carried in accents of ice white and pale cyan.' },
      parallaxFar: { motifs: ['nebula cloud silhouettes', 'a ringed planet'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['ice asteroids, faceted, slowly tumbling'], scrollFactor: 0.12 },
      atmosphere: { kind: 'fine snow', direction: 'falling', speed: 'slow', density: 'moderate', description: 'Fine snow drifting through colored light; points are tinted by whichever aurora band they cross.' },
      ground: { band: 'ice plain horizon', description: 'An ice plain horizon with aurora reflection.' },
      enemyVariants: [
        { baseType: 'Aether Wisp', name: 'Neon Wisp', tweak: 'Ring tinted pink, core white.' },
        { baseType: 'Shroud Phantom', name: 'Frostwraith', tweak: 'Pale body, snow trail.' },
        { baseType: 'Pyre Moth', name: 'Rime Moth', tweak: 'Ice blue-white body; detonation ring is icicle shards.' },
      ],
      uiAccent: 'from-fuchsia-400 to-pink-600',
    } },
  { id: 7, name: 'Golden Sands', theme: 'yellow', textColorClass: 'from-yellow-300 to-amber-600', bossName: 'Dragon Emperor', bossTheme: 'Ancient', skinId: 'solar',
    themeData: {
      palette: { bright: [1.0, 1.0, 0.2], mid: [0.8, 0.8, 0.0], deep: [0.5, 0.5, 0.0], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.8, 0.8, 0.0], intensity: 0.9, position: 'corner', secondaryGlow: null, description: 'Hazy bright dark, a huge low sun glow at one corner: the only off-center sky in the game. The deep band warms toward orange so matte sand and stone never outshine the player.' },
      parallaxFar: { motifs: ['dunes', 'obelisks', 'a broken colossus'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['wind-blown sand sheets (wide, faint, fast)', 'tumbling shards of pottery-bright stone'], scrollFactor: 0.12 },
      atmosphere: { kind: 'blowing sand', direction: 'horizontal', speed: 'fast', density: 'moderate', description: 'Blowing sand, horizontal, fast and thin; mid parallax carries a slight sine wobble as heat shimmer.' },
      ground: { band: 'dune ridge line', description: 'A dune ridge line with ruins half-buried.' },
      enemyVariants: [
        { baseType: 'Shieldback', name: 'Gilded Shieldback', tweak: 'Shield face gold-bronze.' },
        { baseType: 'Seedmother', name: 'Desert Seedmother', tweak: 'Lays sand-buried mines that show only their blinking core above the band line until approached.' },
        { baseType: 'Bastion Golem', name: 'Sandstone Golem', tweak: 'Rocks tan, core amber.' },
      ],
      uiAccent: 'from-yellow-300 to-amber-600',
    } },
  { id: 8, name: 'Blood Moon', theme: 'crimson', textColorClass: 'from-red-500 to-rose-800', bossName: 'Chaos Demon', bossTheme: 'Chaos', skinId: 'eclipse',
    themeData: {
      palette: { bright: [1.0, 0.2, 0.2], mid: [0.8, 0.0, 0.0], deep: [0.5, 0.0, 0.0], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.8, 0.0, 0.0], intensity: 0.5, position: 'high', secondaryGlow: null, description: 'Dark red-black with the blood moon itself: a huge dim red disc high in the field that waxes as the run progresses, so the moon is also the world clock.' },
      parallaxFar: { motifs: ['gothic spires', 'dead trees'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['floating rock and bone-like shards'], scrollFactor: 0.12 },
      atmosphere: { kind: 'blood rain', direction: 'falling', speed: 'fast', density: 'moderate', description: 'Blood rain: red points falling fast at a slight angle, plus slow ash.' },
      ground: { band: 'dark ridge', description: 'A dark ridge with the reflection of the moon in a thin red line.' },
      enemyVariants: [
        { baseType: 'War Chanter', name: 'Blood Chanter', tweak: 'Bell body dark red, pulse ring visible across the field.' },
        { baseType: 'Pyre Moth', name: 'Blood Moth', tweak: 'Deep red body; detonation ring is blood shards.' },
        { baseType: 'Loom Serpent', name: 'Bloodwyrm', tweak: 'Deep red segmented ribbon body.' },
        { baseType: 'Brood Pod', name: 'Heart Pod', tweak: 'The cells visibly beat.' },
      ],
      uiAccent: 'from-red-500 to-rose-800',
    } },
  { id: 9, name: 'Abyssal Rift', theme: 'void', textColorClass: 'from-slate-700 to-black', bossName: 'Eternal Phoenix', bossTheme: 'Divine', skinId: 'celestial',
    themeData: {
      palette: { bright: [0.95, 0.9, 1.0], mid: [0.2, 0.0, 0.4], deep: [0.0, 0.0, 0.0], hostile: HOSTILE_RGB, pickupSafe: true },
      sky: { glow: [0.95, 0.9, 1.0], intensity: 0.9, position: 'off-center vertical rift', secondaryGlow: [0.2, 0.0, 0.4], description: 'Black sky with a vertical rift of light running the height of the field slightly off-center (two glow planes angled, slow light leaking). The rift pulses with the music intensity; the darkest world with the brightest accents.' },
      parallaxFar: { motifs: ['broken world shards: silhouettes of the previous nine worlds, one motif each (basalt spire, sunken pillar, crystal shard, leaf, peak, cathedral shard, ringed planet fragment, obelisk, dead tree)'], scrollFactor: 0.04 },
      parallaxMid: { motifs: ['rift shards of black glass with bright edges'], scrollFactor: 0.12 },
      atmosphere: { kind: 'rift motes and static stars', direction: 'mixed', speed: 'slow', density: 'sparse', description: 'Rift motes rising against gravity on one side of the seam and falling on the other; sparse star points that do not move, the only static atmosphere in the game.' },
      ground: { band: null, description: 'No ground band: the horizon band is removed for the only time in the game; the player flies over open void with the glow of the rift below. The absence is the theme.' },
      enemyVariants: [
        { baseType: 'all roster types', name: 'Rift-touched', tweak: 'Deep palette shifted toward black with white accents, cores at full brightness. Elite-tinted Sturdy and Armored classes appear with 1.5 times HP (a content multiplier on the type, not a new scaling law).' },
      ],
      uiAccent: 'from-slate-700 to-black',
    } },
];

export const ABILITIES: Record<string, { id: string, type: 'tap' | 'double' | 'hold' | 'triple', name: string, desc: string, icon: string, unlockCost: number, upgradeCost: number, baseCooldown: number }> = {
  'drill_attack': { id: 'drill_attack', type: 'tap', name: 'Drill Attack', desc: 'Spin dash through enemies', icon: '🌪️', unlockCost: 500, upgradeCost: 200, baseCooldown: 20 },
  'fire_breath': { id: 'fire_breath', type: 'tap', name: 'Fire Breath', desc: 'Continuous short-range flame', icon: '🔥', unlockCost: 500, upgradeCost: 200, baseCooldown: 8 },
  'burst': { id: 'burst', type: 'tap', name: 'Burst', desc: 'Radial ring of fire bolts', icon: '💥', unlockCost: 0, upgradeCost: 350, baseCooldown: 6 },
  'fire_dart': { id: 'fire_dart', type: 'tap', name: 'Fire Dart', desc: 'One fast long-range dart', icon: '🎯', unlockCost: 400, upgradeCost: 200, baseCooldown: 2 },
  'meteor_rush': { id: 'meteor_rush', type: 'tap', name: 'Meteor Rush', desc: 'Blazing rush through enemies, no protection', icon: '☄️', unlockCost: 400, upgradeCost: 200, baseCooldown: 10 },

  'phoenix_talon': { id: 'phoenix_talon', type: 'double', name: 'Phoenix Talon', desc: 'Fan of three slashing talons', icon: '🦅', unlockCost: 700, upgradeCost: 300, baseCooldown: 7 },
  'spark_storm': { id: 'spark_storm', type: 'double', name: 'Spark Storm', desc: 'Six sparks that hunt separate targets', icon: '⚡', unlockCost: 700, upgradeCost: 300, baseCooldown: 9 },
  'fire_lance': { id: 'fire_lance', type: 'double', name: 'Fire Lance', desc: 'Piercing lance that spears a whole line', icon: '🔱', unlockCost: 700, upgradeCost: 300, baseCooldown: 8 },

  'phoenix_turret': { id: 'phoenix_turret', type: 'hold', name: 'Phoenix Turret', desc: 'Drop an egg that hatches a turret', icon: '🥚', unlockCost: 800, upgradeCost: 300, baseCooldown: 14 },
  'phoenix_inferno': { id: 'phoenix_inferno', type: 'hold', name: 'Phoenix Inferno', desc: 'Channel a burning beam while braked', icon: '🔆', unlockCost: 900, upgradeCost: 400, baseCooldown: 14 },
  'inferno_wave': { id: 'inferno_wave', type: 'hold', name: 'Inferno Wave', desc: 'Expanding ring that hits every enemy once', icon: '⭕', unlockCost: 900, upgradeCost: 400, baseCooldown: 16 },
  'rebirth': { id: 'rebirth', type: 'hold', name: 'Rebirth (Passive)', desc: 'Revive upon death with shockwave', icon: '✨', unlockCost: 1000, upgradeCost: 500, baseCooldown: 75 },
  'aura': { id: 'aura', type: 'hold', name: 'Aura', desc: 'Continuous damage zone', icon: '🌀', unlockCost: 0, upgradeCost: 400, baseCooldown: 17 },
};

// Gadget slot (systems spec Section 5.3, stage S3): one gadget per
// world, bought with coins at ability-band prices, equipped outside
// the move slots. Passive-trigger only, no upgrade levels, and each
// fires at most once per run under its stated trigger.
export const GADGETS: Record<string, { id: string, name: string, desc: string, icon: string, cost: number }> = {
  'phoenix_feather': { id: 'phoenix_feather', name: 'Phoenix Feather Charm', desc: 'Once per run, dying with no revive tokens revives you at 50 percent HP instead.', icon: '🪶', cost: 800 },
  'aegis_charm': { id: 'aegis_charm', name: 'Aegis Charm', desc: 'Start each run with a one-hit shield that negates a single hit. Redundant if you own the Celestial Shield gem.', icon: '🛡️', cost: 700 },
  'focus_charm': { id: 'focus_charm', name: 'Focus Charm', desc: 'Hold-move charge time is cut to three quarters (1.5 s to about 1.1 s).', icon: '🎯', cost: 600 },
};

export const REALM_ABILITIES: Record<number, string[]> = {
  0: ['drill_attack', 'fire_breath', 'burst', 'fire_dart', 'meteor_rush', 'phoenix_talon', 'spark_storm', 'fire_lance', 'phoenix_turret', 'phoenix_inferno', 'inferno_wave', 'rebirth', 'aura']
};

export const ABILITY_UPGRADE_TARGETS: Record<string, { targetLevel: number, stats: Record<string, number> }> = {
  drill_attack: { targetLevel: 30, stats: { cooldown: 0.25, speed: 3.0, duration: 5.0 } },
  burst: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0, radius: 3.0 } },
  phoenix_turret: { targetLevel: 30, stats: { cooldown: 0.5, duration: 3.0, damage: 3.0 } },
  fire_breath: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0, range: 3.0, ammo: 3.0 } },
  aura: { targetLevel: 30, stats: { damage: 5.0, radius: 3.0 } },
  rebirth: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } },
  // S2 moves: the Section 3.5 default shape (cooldown and damage
  // only), so their Section 3 level-1 numbers are the shipped ones
  // and upgrades scale exactly those two axes.
  fire_dart: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } },
  meteor_rush: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } },
  phoenix_talon: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } },
  spark_storm: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } },
  fire_lance: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } },
  // S3 hold moves: the same Section 3.5 default shape as S2.
  phoenix_inferno: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } },
  inferno_wave: { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } }
};

// Deterministic ability upgrades (systems spec Section 3.5, stage S1).
// The old system rolled one random stat increment per level toward these
// targets, so two players at the same level owned different moves and no
// balance number was auditable. Now every level moves every modifier
// exactly 1/targetLevel of the distance from 1.0 toward its target, so
// level L means the same build for everyone and level 30 lands exactly
// on the old system's endpoints. Expected power per level matches the
// old system's average by construction.
export function deterministicAbilityModifiers(abilityId: string, level: number): Record<string, number> {
  const config = ABILITY_UPGRADE_TARGETS[abilityId] || { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } };
  const frac = Math.max(0, Math.min(level, config.targetLevel)) / config.targetLevel;
  const mods: Record<string, number> = {};
  Object.keys(config.stats).forEach(stat => {
    mods[stat] = 1.0 + (config.stats[stat] - 1.0) * frac;
  });
  return mods;
}

export const BASE_STATS: WorldStats = {
  maxHealth: 100, speed: 2.0, magnetism: 1.0, damage: 10, attackSpeed: 1.0,
  burstDamage: 20, auraRadius: 250, homingLevel: 0, attackRange: 400,
  unlockedAbilities: {},
  activeTapAbility: null, activeHoldAbility: null,
  activeDoubleAbility: null, activeTripleAbility: null,
  unlockedGadgets: [], activeGadget: null
};

export const WORLD_0_STATS: WorldStats = {
  ...BASE_STATS,
  unlockedAbilities: {
    'burst': { level: 1, modifiers: deterministicAbilityModifiers('burst', 1) },
    'aura': { level: 1, modifiers: deterministicAbilityModifiers('aura', 1) }
  },
  activeTapAbility: 'burst', activeHoldAbility: 'aura'
};
