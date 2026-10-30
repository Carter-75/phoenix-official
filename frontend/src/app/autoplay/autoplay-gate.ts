// Owner gate for the AI Autoplay tester. The section shows only when
// BOTH the signed-in user's email is the owner address AND the server
// confirms it (GET /api/auth/dev-flags, which checks the JWT session
// and that the account is bound to a verified Google identity). A
// client-only check is never enough on its own.
export const AUTOPLAY_OWNER_EMAIL = 'hello@phoenixwebsites.ai';

export interface GateUser { email?: string | null; isTemp?: boolean; }
export interface DevFlags { isOwner?: boolean; autoplay?: boolean; }

export function clientLooksLikeOwner(user: GateUser | null | undefined): boolean {
  if (!user || user.isTemp) return false;
  return (user.email || '').trim().toLowerCase() === AUTOPLAY_OWNER_EMAIL;
}

export function autoplayAllowed(user: GateUser | null | undefined, flags: DevFlags | null | undefined): boolean {
  return clientLooksLikeOwner(user) && !!flags && flags.isOwner === true && flags.autoplay === true;
}
