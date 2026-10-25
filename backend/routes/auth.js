const express = require('express');
const passport = require('passport');
const router = express.Router();
const User = require('../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const secret = process.env.SESSION_SECRET || 'secret';

function generateToken(user) {
  if (user.isTemp) {
     // Sign plain object for temp user
     return jwt.sign(user, secret, { expiresIn: '1h' });
  }
  return jwt.sign({ id: user._id }, secret, { expiresIn: '30d' });
}

// --- Local Auth ---
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Missing fields' });
    
    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
        return res.status(400).json({ message: 'Email is already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const tempUser = {
        isTemp: true,
        isLocal: true,
        email: email.toLowerCase(),
        password: hashedPassword
    };
    
    const token = generateToken(tempUser);
    res.status(201).json({ user: tempUser, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ message: info.message || 'Login failed' });
    const token = generateToken(user);
    res.json({ user, token });
  })(req, res, next);
});

// --- Complete Google / Local Signup ---
router.post('/complete-signup', async (req, res) => {
    try {
        if (!req.isAuthenticated() || !req.user.isTemp) {
            return res.status(401).json({ message: 'Unauthorized or not in temp state' });
        }
        const { username } = req.body;
        if (!username) return res.status(400).json({ message: 'Username required' });
        
        let existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ message: 'Username is taken' });
        
        let newUserConfig = {
            username: username,
            email: req.user.email,
            acceptedLegalPolicies: true
        };

        if (req.user.isLocal) {
            newUserConfig.password = req.user.password;
        } else {
            newUserConfig.googleId = req.user.googleId;
        }

        const newUser = await User.create(newUserConfig);
        
        const token = generateToken(newUser);
        res.json({ user: newUser, token });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Google Auth ---

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    const frontendUrl = process.env.PROD_FRONTEND_URL || 'http://localhost:4200';
    if (err || !user) {
      return res.redirect(`${frontendUrl}?error=google`);
    }
    
    const token = generateToken(user);
    if (user.isTemp) {
        return res.redirect(`${frontendUrl}?mode=set-username&token=${token}`);
    }
    res.redirect(`${frontendUrl}?token=${token}`);
  })(req, res, next);
});

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post('/google/native', async (req, res) => {
    try {
        const { idToken } = req.body;
        if (!idToken) return res.status(400).json({ message: 'No ID token provided' });

        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: [
                process.env.GOOGLE_CLIENT_ID,
                '108585498879-o171u9a80ssqfkojpd8hohgq6dumk0iu.apps.googleusercontent.com'
            ],
        });
        const payload = ticket.getPayload();
        
        let user = await User.findOne({ googleId: payload.sub });
        if (!user) {
            // Only map to email if it already exists and doesn't have a password, or prompt for linking.
            // Best practice: if user has an email but no googleId, and has a password, reject or require password.
            // For now, only match if they don't have a password (i.e. they are already a google-only user that somehow didn't match sub)
            let existingByEmail = await User.findOne({ email: payload.email });
            if (existingByEmail && existingByEmail.googleId) {
                user = existingByEmail;
            } else if (existingByEmail && !existingByEmail.googleId) {
                return res.status(400).json({ message: 'Email registered locally. Please log in with your password.' });
            }
        }
        
        if (!user) {
            const tempUser = {
                isTemp: true,
                googleId: payload.sub,
                email: payload.email,
            };
            const token = generateToken(tempUser);
            return res.json({ user: tempUser, token });
        } else {
            const token = generateToken(user);
            return res.json({ user, token });
        }
    } catch (err) {
        console.error('Native Google Auth Error:', err);
        res.status(500).json({ error: err.message });
    }
});


// --- Common ---
router.get('/user', passport.authenticate('jwt', { session: false }), (req, res) => {
  res.json(req.user);
});

router.post('/sync', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const user = req.user;
    
    // Server-side validation
    if (typeof req.body.coins === 'number' && req.body.coins >= 0 && req.body.coins < 9999999) user.coins = req.body.coins;
    if (typeof req.body.gems === 'number' && req.body.gems >= 0 && req.body.gems < 999999) user.gems = req.body.gems;
    if (typeof req.body.level === 'number' && req.body.level >= 0 && req.body.level < 10000) user.level = req.body.level;
    if (typeof req.body.xp === 'number' && req.body.xp >= 0 && req.body.xp < 999999999) user.xp = req.body.xp;
    
    if (Array.isArray(req.body.unlockedWorlds)) user.unlockedWorlds = req.body.unlockedWorlds;
    if (Array.isArray(req.body.trophies)) user.trophies = req.body.trophies;
    if (Array.isArray(req.body.unlockedEnemies)) user.unlockedEnemies = req.body.unlockedEnemies;
    
    // Battle Mode
    if (typeof req.body.battleHighscore === 'number' && req.body.battleHighscore > (user.battleHighscore || 0)) user.battleHighscore = req.body.battleHighscore;
    if (typeof req.body.battleBestTime === 'number' && req.body.battleBestTime > (user.battleBestTime || 0)) user.battleBestTime = req.body.battleBestTime;
    if (typeof req.body.battleBestCoins === 'number' && req.body.battleBestCoins > (user.battleBestCoins || 0)) user.battleBestCoins = req.body.battleBestCoins;
    
    // Cosmetics & Premium
    if (req.body.hasCosmicTrail !== undefined) user.hasCosmicTrail = req.body.hasCosmicTrail;
    if (req.body.hasGoldenAura !== undefined) user.hasGoldenAura = req.body.hasGoldenAura;
    if (req.body.hasCelestialShield !== undefined) user.hasCelestialShield = req.body.hasCelestialShield;
    if (req.body.hasPurchasedGems !== undefined) user.hasPurchasedGems = req.body.hasPurchasedGems;
    if (req.body.toggleCosmicTrail !== undefined) user.toggleCosmicTrail = req.body.toggleCosmicTrail;
    if (req.body.toggleGoldenAura !== undefined) user.toggleGoldenAura = req.body.toggleGoldenAura;
    if (req.body.toggleCelestialShield !== undefined) user.toggleCelestialShield = req.body.toggleCelestialShield;

    // Progression & Deals
    if (req.body.upsellChance !== undefined) user.upsellChance = req.body.upsellChance;
    if (req.body.coinMultiplier !== undefined) user.coinMultiplier = req.body.coinMultiplier;
    if (req.body.xpMultiplier !== undefined) user.xpMultiplier = req.body.xpMultiplier;
    if (req.body.crazyDealExpiresAt !== undefined) user.crazyDealExpiresAt = req.body.crazyDealExpiresAt;
    
    if (req.body.acceptedLegalPolicies !== undefined) user.acceptedLegalPolicies = req.body.acceptedLegalPolicies;

    if (req.body.worldUpgrades) {
        user.worldUpgrades = req.body.worldUpgrades;
        user.markModified('worldUpgrades');
    }
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/logout', (req, res) => {
  // Client is responsible for deleting the token
  res.json({ message: 'Logged out' });
});

router.post('/accept-policies', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        req.user.acceptedLegalPolicies = true;
        await req.user.save();
        res.json({ message: 'Policies accepted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/user', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        await User.findByIdAndDelete(req.user._id);
        res.json({ message: 'Account deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
