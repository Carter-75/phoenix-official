const express = require('express');
const passport = require('passport');
const router = express.Router();
const { GoogleAuth } = require('google-auth-library');
const User = require('../models/user');
const Entitlement = require('../models/Entitlement');

// Server-side Google Play receipt verification (audit bugs 10, 11, 19).
// The client never grants itself anything for a real purchase. It sends the
// purchase token here; this route asks Google's Play Developer API whether
// the purchase is real, and only then writes an Entitlement and applies the
// grant. Fails closed: if the service account is not configured, or Google
// says the purchase is not in a purchased state, nothing is granted.

const PACKAGE_NAME = () => process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.phoenix.fall';
const SUB_PRODUCT_ID = 'com.phoenix.sub.monthly';
const REMOVE_ADS_ID = 'com.phoenix.removeads';

const GEM_AMOUNTS = {
  'com.phoenix.gems.tier1': 20,
  'com.phoenix.gems.tier2': 150,
  'com.phoenix.gems.tier3': 1000
};
const BOOST_PRODUCTS = {
  'com.phoenix.temp.multiplier.x2': { multiplier: 2, ms: 60 * 1000 },
  'com.phoenix.temp.multiplier.x10': { multiplier: 10, ms: 5 * 60 * 1000 }
};
const KNOWN_PRODUCTS = new Set([
  ...Object.keys(GEM_AMOUNTS), ...Object.keys(BOOST_PRODUCTS), SUB_PRODUCT_ID, REMOVE_ADS_ID
]);

function billingConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

async function playApiGet(path) {
  const auth = new GoogleAuth({
    credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
      : undefined,
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
  const client = await auth.getClient();
  const res = await client.request({ url: `https://androidpublisher.googleapis.com/androidpublisher/v3/${path}` });
  return res.data;
}

router.post('/verify', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { productId, purchaseToken } = req.body || {};
    if (!productId || !purchaseToken) {
      return res.status(400).json({ ok: false, message: 'productId and purchaseToken are required.' });
    }
    if (!KNOWN_PRODUCTS.has(productId)) {
      return res.status(400).json({ ok: false, message: 'Unknown product.' });
    }
    if (!billingConfigured()) {
      // Fail closed: no service account, no grants. The purchase stays
      // pending in Google Play and can be re-verified once configured.
      return res.status(503).json({ ok: false, code: 'BILLING_NOT_CONFIGURED', message: 'Receipt verification is not configured on the server yet.' });
    }

    const pkg = PACKAGE_NAME();
    let orderId = null;
    let subExpiry = null;

    if (productId === SUB_PRODUCT_ID) {
      const data = await playApiGet(`applications/${pkg}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);
      const activeStates = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'];
      if (!activeStates.includes(data.subscriptionState)) {
        return res.status(400).json({ ok: false, message: `Subscription is not active (${data.subscriptionState || 'unknown'}).` });
      }
      orderId = data.latestOrderId;
      const line = (data.lineItems || [])[0];
      subExpiry = line?.expiryTime ? new Date(line.expiryTime) : null;
    } else {
      const data = await playApiGet(`applications/${pkg}/purchases/products/${productId}/tokens/${encodeURIComponent(purchaseToken)}`);
      if (data.purchaseState !== 0) {
        return res.status(400).json({ ok: false, message: 'Purchase is not in a purchased state.' });
      }
      orderId = data.orderId;
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });

    // Idempotency: one grant per Google order.
    const txId = orderId || purchaseToken;
    const existing = await Entitlement.findOne({ transactionId: txId });
    if (existing) {
      return res.json({ ok: true, alreadyGranted: true });
    }
    await Entitlement.create({
      userId: user._id, productId, source: 'play', transactionId: txId, expiresAt: subExpiry
    });

    if (GEM_AMOUNTS[productId]) {
      let amount = GEM_AMOUNTS[productId];
      if (!user.hasPurchasedGems) {
        amount *= 2; // first purchase bonus, same rule the store displays
        user.hasPurchasedGems = true;
      }
      user.gems = (user.gems || 0) + amount;
    } else if (BOOST_PRODUCTS[productId]) {
      const boost = BOOST_PRODUCTS[productId];
      const now = Date.now();
      user.boostMultiplier = boost.multiplier;
      user.boostExpiresAt = Math.max(now, user.boostExpiresAt || 0) + boost.ms;
    } else if (productId === REMOVE_ADS_ID) {
      user.hasRemoveAds = true;
    }
    await user.save();

    const obj = user.toObject();
    delete obj.password;
    delete obj.pushSubscriptions;
    obj.hasActiveSub = productId === SUB_PRODUCT_ID ? true : obj.hasActiveSub;
    res.json({ ok: true, user: obj });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(400).json({ ok: false, message: 'Google Play could not find that purchase.' });
    }
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
