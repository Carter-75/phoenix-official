require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const leaderboardRoutes = require('./routes/leaderboard');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: origins.length ? origins : true,
    credentials: false,
  })
);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    service: 'phoenix-official-backend',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

app.use((req, res) => res.status(404).json({ message: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('MONGODB_URI is not set. API will run but database calls will fail. See backend/.env.example');
    return;
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB:', mongoose.connection.name);
}

if (require.main === module) {
  const port = process.env.PORT || 4000;
  connect()
    .catch((err) => console.error('MongoDB connection failed:', err.message))
    .finally(() => {
      app.listen(port, () => console.log(`Phoenix backend listening on port ${port}`));
    });
}

module.exports = { app, connect };
