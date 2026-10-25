const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/user');
const AdReward = require('../models/AdReward');
const Entitlement = require('../models/Entitlement');

// AdMob server-side verification (SSV) callback for rewarded ads.
// Protocol (Google's SSV docs): the callback's last two query parameters are
// always signature and key_id. The signed content is the raw query string up
// to the '&' before signature=. The signature is ECDSA P-256 / SHA-256, DER
// encoded, base64url. Verifier keys come from Google's key server as JSON
// ({ keys: [{ keyId, pem, base64 }] }) and may be cached at most 24 hours.
// We verify before granting anything and dedupe on transaction_id so a
// replayed callback can never grant twice.
//
// The client sets custom_data to the placement kind (revive, boost,
// revive_token, bubble) and user_id via the plugin's SSV options. Grants:
//   boost       -> 2x coins and XP for 5 minutes (server boost fields)
//   revive_token-> +1 revive token (max 20)
//   coins/gems  -> balance grant of reward_amount (capped)
//   revive/bubble are verified and recorded; their rewards apply in the
//   client flow. Guests (no user_id) are acknowledged but granted nothing.

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
let keyCache = { keys: [], fetchedAt: 0 };

async function getVerificationKeys(force = false) {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (!force && keyCache.keys.length && Date.now() - keyCache.fetchedAt < ONE_DAY) return keyCache.keys;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error('Could not fetch AdMob verification keys');
  const data = await res.json();
  const keys = (data.keys || []).map(k => ({ keyId: String(k.keyId), pem: k.pem }));
  if (keys.length) keyCache = { keys, fetchedAt: Date.now() };
  return keys;
}

function verifyWithKey(content, signatureB64Url, pem) {
  let b64 = signatureB64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const sig = Buffer.from(b64, 'base64');
  try {
    return crypto.verify('sha256', Buffer.from(content, 'utf8'), { key: pem, dsaEncoding: 'der' }, sig);
  } catch (e) {
    return false;
  }
}

router.get('/ssv', async (req, res) => {
  try {
    const raw = req.originalUrl.split('?')[1] || '';
    const sigMarker = '&signature=';
    const sigIdx = raw.indexOf(sigMarker);
    if (sigIdx === -1) return res.status(400).send('Missing signature');
    const content = raw.slice(0, sigIdx);
    const tail = raw.slice(sigIdx + sigMarker.length); // "<signature>&key_id=<id>"
    const keyMarker = '&key_id=';
    const keyIdx = tail.indexOf(keyMarker);
    if (keyIdx === -1) return res.status(400).send('Missing key_id');
    const signature = tail.slice(0, keyIdx);
    const keyId = tail.slice(keyIdx + keyMarker.length).split('&')[0];

    let keys = await getVerificationKeys();
    let key = keys.find(k => k.keyId === String(keyId));
    if (!key) {
      keys = await getVerificationKeys(true); // key rotation: refetch once
      key = keys.find(k => k.keyId === String(keyId));
    }
    if (!key || !verifyWithKey(content, signature, key.pem)) {
      return res.status(403).send('Invalid signature');
    }

    const q = req.query;
    const transactionId = q.transaction_id;
    if (!transactionId) return res.status(400).send('Missing transaction_id');

    const dupe = await AdReward.findOne({ transactionId }).lean();
    if (dupe) return res.status(200).send('OK'); // already granted

    const userId = typeof q.user_id === 'string' ? q.user_id : null;
    const kind = typeof q.custom_data === 'string' ? q.custom_data : null;
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
