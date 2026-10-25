const express = require('express');
const passport = require('passport');
const router = express.Router();
const webpush = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:hello@phoenixwebsites.ai',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
} else {
    console.warn("VAPID keys not configured. Push notifications will not work.");
}

router.get('/vapidPublicKey', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// Subscribe requires a real logged-in user (passport JWT). Audit bug 16: the
// old code called req.isAuthenticated() with sessions removed, so this could
// never succeed, and the sibling trigger-deal endpoint was unauthenticated
// and could push a fake deal to every user. That endpoint is deleted.
router.post('/subscribe', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Invalid subscription' });
    }
    const user = req.user;
    const exists = (user.pushSubscriptions || []).some(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
        user.pushSubscriptions.push(subscription);
        await user.save();
    }
    res.status(201).json({ message: 'Subscription saved.' });
});

module.exports = router;
