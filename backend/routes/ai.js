const express = require('express');
const router = express.Router();
const GlobalAi = require('../models/GlobalAi');

// Get current global weights
router.get('/weights', async (req, res) => {
    try {
        const globalAi = await GlobalAi.findOne().sort({ version: -1 });
        if (!globalAi) return res.status(404).json({ message: 'No global weights found' });
        res.json({ weights: globalAi.weights, version: globalAi.version });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update global weights
router.post('/weights', async (req, res) => {
    try {
        const { weights } = req.body;
        if (!weights) return res.status(400).json({ error: 'Weights required' });
        
        let globalAi = await GlobalAi.findOne().sort({ version: -1 });
        if (globalAi) {
            globalAi.weights = weights;
            globalAi.updatedAt = Date.now();
            globalAi.version += 1;
            await globalAi.save();
        } else {
            globalAi = new GlobalAi({ weights });
            await globalAi.save();
        }
        res.json({ success: true, version: globalAi.version });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
