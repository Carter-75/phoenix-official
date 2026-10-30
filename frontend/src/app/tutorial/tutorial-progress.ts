// Tutorial completion flag, kept in the same localStorage the game
// uses for its other preferences (StorageService). Values:
//   'done'    finished every step
//   'skipped' dismissed the first-launch offer or skipped midway
// Absent means the first-launch offer has never been answered.
export const TUTORIAL_STATE_KEY = 'phoenix_tutorial_state';

export type TutorialState = 'done' | 'skipped' | null;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readTutorialState(store: KeyValueStore): TutorialState {
  const v = store.getItem(TUTORIAL_STATE_KEY);
  return v === 'done' || v === 'skipped' ? v : null;
}

export function writeTutorialState(store: KeyValueStore, state: 'done' | 'skipped'): void {
  // A finished tutorial is never downgraded by a later skip.
  if (state === 'skipped' && readTutorialState(store) === 'done') return;
  store.setItem(TUTORIAL_STATE_KEY, state);
}

// The first-launch offer shows only while the flag is unanswered, and
// never inside automation (cloud device test build, debug hooks), so
// scripted runs are not blocked by a modal.
export function shouldOfferTutorial(store: KeyValueStore, automation: boolean): boolean {
  if (automation) return false;
  return readTutorialState(store) === null;
}
