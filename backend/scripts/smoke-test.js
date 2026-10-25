// Smoke test: boots the real backend against an in-memory MongoDB and runs
// the full account flow. Run: npm run test:smoke
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.GOOGLE_CLIENT_IDS = '';

const assert = require('assert');

async function main() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + 'phoenix-official';

  const mongoose = require('mongoose');
  const { app, connect } = require('../app');
  await connect();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  try {
    let r = await call('GET', '/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.db, 'connected');
    console.log('ok health');

    r = await call('GET', '/auth/username-available?username=SmokeTester');
    assert.strictEqual(r.json.available, true);
    console.log('ok username available');

    r = await call('POST', '/auth/register', { email: 'smoke@test.dev', password: 'short', username: 'SmokeTester' });
    assert.strictEqual(r.status, 400);
    console.log('ok short password rejected');

    r = await call('POST', '/auth/register', {
      email: 'smoke@test.dev',
      password: 'password123',
      username: 'SmokeTester',
      acceptedLegalPolicies: true,
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    const token = r.json.token;
    assert.ok(token && r.json.user.username === 'SmokeTester');
    assert.ok(!JSON.stringify(r.json).includes('passwordHash'));
    console.log('ok register creates a real user');

    r = await call('POST', '/auth/register', { email: 'other@test.dev', password: 'password123', username: 'SmokeTester' });
    assert.strictEqual(r.status, 400);
    console.log('ok duplicate username rejected');

    r = await call('POST', '/auth/login', { email: 'smoke@test.dev', password: 'wrong-password' });
    assert.strictEqual(r.status, 401);
    r = await call('POST', '/auth/login', { email: 'smoke@test.dev', password: 'password123' });
    assert.strictEqual(r.status, 200);
    console.log('ok login');

    r = await call('GET', '/auth/me', null, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.user.coins, 50);
    console.log('ok me');

    r = await call('POST', '/game/sync', { coins: 500, level: 3, xp: 40, unlockedWorlds: [1, 2], activeSkin: 'ember' }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.user.coins, 500);
    console.log('ok sync');

    r = await call('POST', '/game/score/world', { worldId: 1, score: 4200, timeSec: 95, completed: true }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.campaignScore, 4200);
    console.log('ok world score + next world unlock');
    r = await call('GET', '/auth/me', null, token);
    assert.ok(r.json.user.unlockedWorlds.includes(2));

    r = await call('POST', '/game/score/battle', { won: true, score: 1500 }, token);
    assert.strictEqual(r.json.battleRating, 25);
    console.log('ok battle score');

    for (const path of ['/leaderboard/global', '/leaderboard/campaign', '/leaderboard/world/1', '/leaderboard/battle']) {
      r = await call('GET', path);
      assert.strictEqual(r.status, 200, path);
      assert.ok(Array.isArray(r.json) && r.json.length >= 1 && r.json[0].username === 'SmokeTester', path);
    }
    console.log('ok all 4 leaderboards');

    r = await call('DELETE', '/auth/me', null, token);
    assert.strictEqual(r.status, 200);
    r = await call('GET', '/auth/me', null, token);
    assert.strictEqual(r.status, 401);
    console.log('ok account deletion');

    console.log('SMOKE TEST PASSED');
  } finally {
    server.close();
    await mongoose.disconnect();
    await mongod.stop();
  }
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
