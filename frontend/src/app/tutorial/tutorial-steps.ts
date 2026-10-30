import { SURVIVE_PHASE_SEC, BOSS_PHASE_SEC, RAGE_PHASE_SEC } from '../data/boss-phase';

export function fmtClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
// How to Play step script. Every number in the copy is taken from the
// game code (see tutorial-input.ts and the constants it imports); the
// spec in frontend/tests checks the key ones.
import { STAMINA_RULES_FOR_COPY } from './tutorial-copy-numbers';

export type TutorialGoal =
  | 'steer' | 'slot-tap' | 'slot-double' | 'slot-triple' | 'hold'
  | 'dash' | 'roll' | 'brake' | 'glide' | 'spark' | 'pickups' | 'info';

export type FingerAnim = 'drag' | 'tap2' | 'tap3' | 'tap4' | 'hold' | 'flick' | 'roll' | 'brake' | 'glide' | 'none';

export type HudTarget = 'arena' | 'slot-tap' | 'slot-hold' | 'slot-double' | 'slot-triple' | 'stamina' | 'hp' | 'level' | 'pills' | 'slots' | 'none';

export interface TutorialStep {
  id: string;
  section: string;
  title: string;
  body: string;           // touch copy
  desktop?: string;       // shown only when the device has no touch
  goal: TutorialGoal;
  finger: FingerAnim;
  highlight: HudTarget;
  icon?: string;
}

const S = STAMINA_RULES_FOR_COPY;

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'steer', section: 'Flight', title: 'Drag to fly',
    body: `Put a finger down anywhere and drag. The phoenix follows your finger's motion (about ${S.dragScale}x your swipe), not the spot you touch, so you never cover the bird. There is no joystick. Lift your finger and it settles in place.`,
    desktop: 'Move the mouse: the phoenix flies toward the pointer.',
    goal: 'steer', finger: 'drag', highlight: 'arena', icon: '🪶',
  },
  {
    id: 'slot-tap', section: 'Abilities', title: 'Tap ability',
    body: 'Your phoenix fires on its own. To cast the TAP slot, tap twice quickly (quick taps, not drags; a single tap does nothing). Each gesture fires only its own slot, then that slot shows a cooldown sweep until it is ready again.',
    desktop: 'Two quick clicks, or press Q.',
    goal: 'slot-tap', finger: 'tap2', highlight: 'slot-tap', icon: '💥',
  },
  {
    id: 'slot-double', section: 'Abilities', title: 'Double ability',
    body: 'Tap three times quickly to cast the DBL slot. Wait for the sweep to clear before casting a slot again.',
    desktop: 'Three quick clicks, or press W.',
    goal: 'slot-double', finger: 'tap3', highlight: 'slot-double', icon: '⚡',
  },
  {
    id: 'slot-triple', section: 'Abilities', title: 'Ultimate',
    body: 'Tap four times quickly for the ULT slot, your biggest move with the longest cooldown. In a run it unlocks once you beat that realm\'s boss; here you can try it right away.',
    desktop: 'Four quick clicks, or press R. In a run, Esc pauses (here it skips the tutorial).',
    goal: 'slot-triple', finger: 'tap4', highlight: 'slot-triple', icon: '✨',
  },
  {
    id: 'hold', section: 'Abilities', title: 'Press and hold',
    body: `Press and keep your finger still. After a short ${S.holdArmS} s settle, a ring fills over ${S.holdChargeS} s and the HOLD slot fires. Moving clears the charge, so plant your finger.`,
    desktop: 'Hold the left mouse button still.',
    goal: 'hold', finger: 'hold', highlight: 'slot-hold', icon: '🌀',
  },
  {
    id: 'dash', section: 'Moves', title: 'Flick Dash',
    body: `Flick: a quick swipe released within ${S.flickMs} ms that travels at least ${S.flickPct}% of the screen. You burst that way and can't be hit for a moment. Costs ${S.dashCost} stamina.`,
    desktop: 'Press Shift to dash toward the pointer.',
    goal: 'dash', finger: 'flick', highlight: 'stamina', icon: '💨',
  },
  {
    id: 'roll', section: 'Moves', title: 'Air Roll',
    body: `While steering with one finger, quickly tap a second finger (under ${S.rollTapMs} ms). The phoenix rolls sideways and can't be hit during the roll. Costs ${S.rollCost} stamina.`,
    desktop: 'Press E to roll.',
    goal: 'roll', finger: 'roll', highlight: 'stamina', icon: '🌪️',
  },
  {
    id: 'brake', section: 'Moves', title: 'Feather Brake',
    body: `While steering, hold a second finger down to fly at ${S.brakePct}% speed for tight dodging. Lift it to speed back up. Braking costs no stamina.`,
    desktop: 'Hold Space or the right mouse button.',
    goal: 'brake', finger: 'brake', highlight: 'arena', icon: '🪽',
  },
  {
    id: 'glide', section: 'Stamina', title: 'Stamina and Glide',
    body: `The ring at the bottom left is your stamina: ${S.max} total. It refills on its own only slowly (${S.regen} per second, starting ${S.regenDelayS} s after you spend, about ${S.regenFull} s from empty), so Spark Cells are your main refill. Fly straight and steady for ${S.glideS} s and the ring glows white: Glide doubles the refill and halves the cost of your next move. Hold a steady line until it glows.`,
    goal: 'glide', finger: 'glide', highlight: 'stamina', icon: '⚪',
  },
  {
    id: 'spark', section: 'Stamina', title: 'Spark Cells',
    body: `Enemies drop Spark Cells, fast ones most often. Grab one for an instant +${S.sparkCell} stamina: it is how you keep dashing and rolling. Fly into the cell.`,
    goal: 'spark', finger: 'none', highlight: 'stamina', icon: '🔋',
  },
  {
    id: 'pickups', section: 'Loot', title: 'Pickups',
    body: `Enemies drop coins, XP orbs, and hearts that drift toward you when you get close (Magnetism in the shop widens the pull). Coins buy upgrades, XP raises your level, and a heart heals ${S.heartHeal} HP. Collect them all.`,
    goal: 'pickups', finger: 'none', highlight: 'arena', icon: '🪙',
  },
  {
    id: 'hp', section: 'Survival', title: 'Health and level',
    body: `This is your health bar. Each account level (the LV badge) adds ${S.hpPerLevel} max HP, up to +${S.hpCap}. Take too much damage and you are knocked down; you can revive or end the run.`,
    goal: 'info', finger: 'none', highlight: 'hp', icon: '❤️',
  },
  {
    id: 'gadgets', section: 'Survival', title: 'Gadgets and charges',
    body: `Status pills sit next to the stamina ring. Aegis Charm (a gadget from the shop) blocks one hit per run, then dims. Overcharge, a rare drop from tougher enemies, lets your next non-ultimate cast ignore its cooldown within ${S.overchargeS} s.`,
    goal: 'info', finger: 'none', highlight: 'pills', icon: '🛡️',
  },
  {
    id: 'realms', section: 'The journey', title: 'Realms and bosses',
    body: `There are ${S.realms} realms. Each starts with SURVIVE: ${fmtClock(SURVIVE_PHASE_SEC)} as the enemies ramp up. At 0:00 the boss arrives and the timer becomes ${fmtClock(BOSS_PHASE_SEC)} to DEFEAT THE BOSS. Beat it to ascend straight into the next realm, keeping your health. If the timer runs out the boss enters RAGE for ${RAGE_PHASE_SEC} s, hitting harder and faster. If RAGE runs out too, its final attack covers the whole screen and cannot be survived or revived.`,
    goal: 'info', finger: 'none', highlight: 'none', icon: '👑',
  },
  {
    id: 'loadouts', section: 'The journey', title: 'Loadouts and the shop',
    body: 'Each realm keeps its own loadout of upgrades and equipped abilities. Purchases and equips apply to the realm you buy them in; a new realm starts with the Burst and Aura starter kit. Open the shop with the + next to your coins or gems.',
    goal: 'info', finger: 'none', highlight: 'none', icon: '🛒',
  },
  {
    id: 'modes', section: 'The journey', title: 'Boosts and modes',
    body: 'The menu offers an optional ad boost: 2x coins and XP for 5 minutes. While a boost runs, a chip with its countdown shows in the menu and in game. Besides the normal climb there is Endless (survive escalating waves) and Battle (duel a rival phoenix in any unlocked realm).',
    goal: 'info', finger: 'none', highlight: 'none', icon: '⚔️',
  },
  {
    id: 'done', section: 'Ready', title: 'You are ready to rise',
    body: 'That is everything. You can replay this tutorial any time from How to Play in the menu or from Settings.',
    goal: 'info', finger: 'none', highlight: 'none', icon: '🐦‍🔥',
  },
];
