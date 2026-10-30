// Briefly outlines the shop card that holds a buy button, so a
// purchase made off-screen (by autoplay or any code) is visible.
export function highlightPurchase(btn: HTMLElement | null): void {
  if (!btn || typeof document === 'undefined') return;
  const card = (btn.closest('[data-shop-card]') as HTMLElement) || btn.parentElement?.parentElement || btn;
  card.classList.remove('purchase-flash');
  void card.offsetWidth;
  card.classList.add('purchase-flash');
  setTimeout(() => card.classList.remove('purchase-flash'), 1600);
}

const KEBAB: Record<string, string> = { attackSpeed: 'attack-speed', homingLevel: 'homing', maxHealth: 'health', auraRadius: 'aura', attackRange: 'range', aegisPlating: 'aegis', magnetism: 'magnet' };
/** data-ap tag of the buy button for a stat key. */
export function buyTagFor(stat: string): string { return 'buy-' + (KEBAB[stat] ?? stat); }
