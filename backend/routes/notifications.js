const express = require('express');
const router = express.Router();
const webpush = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@phoenixfall.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
} else {
    console.warn("VAPID keys not configured. Push notifications will not work.");
}

router.get('/vapidPublicKey', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/subscribe', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
    
    const subscription = req.body;
    const user = req.user;

    // Check if subscription already exists
    const exists = user.pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
        user.pushSubscriptions.push(subscription);
        await user.save();
    }
    
    res.status(201).json({ message: 'Subscription saved.' });
});

// Admin-only route or triggered by internal CRON (simulated here for demonstration)
router.post('/trigger-deal', async (req, res) => {
    // In reality, this would be secured.
    const { title, message, triggerCrazyDeal } = req.body;
    
    // Send to all users who have a subscription
    const User = require('../models/user');
    const users = await User.find({ "pushSubscriptions.0": { "$exists": true } });
    
    let promises = [];
    users.forEach(user => {
        user.pushSubscriptions.forEach(sub => {
            const payload = JSON.stringify({
                title: title || 'Ghost Deal! 👻',
                body: message || '3X Gems are live! Jump back in now.',
                icon: '/assets/gem_icon.png',
                crazyDealExpiresAt: triggerCrazyDeal ? Date.now() + 1000 * 60 * 5 : null,
                url: '/'
            });
            promises.push(
                webpush.sendNotification(sub, payload).catch(err => {
                    console.error("Error sending push to", user.username, err);
                    // Optionally remove dead subscriptions here (HTTP 410)
                })
            );
        });
    });
    
    await Promise.all(promises);
    res.json({ message: 'Push sent.' });
});

module.exports = router;
