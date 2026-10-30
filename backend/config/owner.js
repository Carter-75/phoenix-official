// Owner gate for dev-only tools (AI Autoplay tester). The account must
// be the owner email AND carry a googleId, which is only ever set by
// the server-verified Google ID token sign-in, so a password account
// registered with the same email string never passes.
const OWNER_EMAIL = 'hello@phoenixwebsites.ai';

function isOwnerUser(user) {
  if (!user || typeof user !== 'object') return false;
  const email = String(user.email || '').trim().toLowerCase();
  return email === OWNER_EMAIL && !!user.googleId && !user.isTemp;
}

module.exports = { OWNER_EMAIL, isOwnerUser };
