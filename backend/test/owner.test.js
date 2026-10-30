const test = require('node:test');
const assert = require('node:assert');
const { isOwnerUser } = require('../config/owner');

test('owner requires email and verified googleId', () => {
  assert.strictEqual(isOwnerUser({ email: 'hello@phoenixwebsites.ai', googleId: 'g1' }), true);
  assert.strictEqual(isOwnerUser({ email: 'HELLO@phoenixwebsites.ai ', googleId: 'g1' }), true);
  assert.strictEqual(isOwnerUser({ email: 'hello@phoenixwebsites.ai' }), false);
  assert.strictEqual(isOwnerUser({ email: 'other@x.com', googleId: 'g' }), false);
  assert.strictEqual(isOwnerUser({ email: 'hello@phoenixwebsites.ai', googleId: 'g', isTemp: true }), false);
  assert.strictEqual(isOwnerUser(null), false);
});

test('autoplay route helpers', () => {
  const { rateOk, isReasoningModel } = require('../routes/autoplay')._test;
  assert.strictEqual(isReasoningModel('gpt-5-nano'), true);
  assert.strictEqual(isReasoningModel('gpt-4o-mini'), false);
  let ok = 0; for (let i = 0; i < 10; i++) if (rateOk('u', 'plan', 1000)) ok++;
  assert.strictEqual(ok, 6);
});
