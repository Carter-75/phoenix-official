const mongoose = require('mongoose');

const GlobalAiSchema = new mongoose.Schema({
    weights: { type: Object, required: true },
    version: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GlobalAi', GlobalAiSchema);
