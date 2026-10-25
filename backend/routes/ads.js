const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/user');
const AdReward = require('../models/AdReward');
const Entitlement = require('../models/Entitlement');

// AdMob server-side verification (SSV) callback for rewarded ads.
// Google calls this URL when a user finishes a rewarded ad. The query string
// is signed with ECDSA-SHA256; we verify it against Google's published
// reward verification keys before granting anything, and we dedupe on
// transaction_id so a replayed callback grants nothing twice.
//
// The ad's custom_data is set by the client as "userId:kind" where kind is
// one of: revive_token, boost, coins, gems. Guests (no userId) are verified
// and acknowledged but granted nothing.

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifying-key.pem';
let keyCache = { pems: [], fetchedAt: 0 };

async function getVerificationKeys() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (keyCache.pems.length && Date.now() - keyCache.fetchedAt < ONE_DAY) return keyCache.pems;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error('Could not fetch AdMob verification keys');
  const text = await res.text();
  const pems = text.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g) || [];
  if (pems.length) keyCache = { pems, fetchedAt: Date.now() };
  return pems;
}

function verifySignature(content, signatureB64, pems) {
  const sig = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  for (const pem of pems) {
    try {
      if (crypto.verify('sha256', Buffer.from(content, 'utf8'), pem, sig)) return true;
    } catch (e) { /* try next key */ }
  }
  return false;
}

router.get('/ssv', async (req, res) => {
  try {
    const raw = req.originalUrl.split('?')[1] || '';
    const sigMarker = '&signature=';
    const sigIdx = raw.indexOf(sigMarker);
    if (sigIdx === -1) return res.status(400).send('Missing signature');
    // Signed content: every parameter before signature, in the order sent.
    const content = raw.slice(0, sigIdx);
    const rest = raw.slice(sigIdx + sigMarker.length);
    const signature = rest.split('&')[0];

    const pems = await getVerificationKeys();
    if (!pems.length || !verifySignature(content, signature, pems)) {
      return res.status(403).send('Invalid signature');
    }

    const q = req.query;
    const transactionId = q.transaction_id;
    if (!transactionId) return res.status(400).send('Missing transaction_id');

    const dupe = await AdReward.findOne({ transactionId }).lean();
    if (dupe) return res.status(200).send('OK'); // already granted

    let userId = null;
    let kind = null;
    if (typeof q.custom_data === 'string' && q.custom_data.includes(':')) {
      const [uid, k] = q.custom_data.split(':');
      userId = uid; kind = k;
    }
    if (!userId && typeof q.user_id === 'string') userId = q.user_id;

    const rewardAmount = parseInt(q.reward_amount, 10) || 0;
    let grantedUser = null;
    if (userId && /^[a-f0-9]{24}$/i.test(userId)) {
      const user = await User.findById(userId);
      if (user) {
        if (kind === 'revive_token') {
          user.reviveTokens = Math.min(20, (user.reviveTokens || 0) + 1);
        } else if (kind === 'boost') {
          user.boostMultiplier = 2;
          user.boostExpiresAt = Math.max(Date.now(), user.boostExpiresAt || 0) + 5 * 60 * 1000;
        } else if (kind === 'coins') {
          user.coins = (user.coins || 0) + Math.min(Math.max(rewardAmount, 0), 10000);
        } else if (kind === 'gems') {
          user.gems = (user.gems || 0) + Math.min(Math.max(rewardAmount, 0), 100);
        }
        await user.save();
        grantedUser = user._id;
        await Entitlement.create({ userId: user._id, productId: `ssv:${kind || 'reward'}`, source: 'ssv', transactionId });
      }
    }

    await AdReward.create({
      transactionId,
      userId: grantedUser || undefined,
      kind: kind || 'anonymous',
      rewardItem: q.reward_item,
      rewardAmount
    });
    res.status(200).send('OK');
  } catch (err) {
    if (err.code === 11000) return res.status(200).send('OK'); // race duplicate
    res.status(500).send('SSV error');
  }
});

module.exports = router;
