const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const explainFixRoutes = require('./routes/explainFix.routes');
const voiceToLogicRoutes = require('./routes/voiceToLogic.routes');
const captureFixRoutes = require('./routes/captureFix.routes');
const voiceInputRoutes = require('./routes/voiceInput.routes');
const { isOnlineMode } = require('./config/mode');
const { apiProtection, issueCsrfCookie } = require('./middleware/security');
const { closeOcrWorker } = require('./services/ocr.service');
const { closeVoiceModels } = require('./services/voice.service');

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
const allowedOrigin = process.env.CORS_ORIGIN || false;
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '100kb' }));
app.use(issueCsrfCookie);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'" });
  next();
});
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html' || req.path === '/app.js' || req.path === '/app.css' || req.path === '/sw.js') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    name: 'RedLine',
    status: 'ok',
    ai: isOnlineMode() ? 'cloud' : 'cloud-unavailable',
    onlineMode: isOnlineMode(),
    version: '1.0.0',
  });
});

app.use('/api', apiProtection);
app.use('/api/explain-fix', explainFixRoutes);
app.use('/api/voice-to-logic', voiceToLogicRoutes);
app.use('/api/capture-fix', captureFixRoutes);
app.use('/api/voice-input', voiceInputRoutes);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file exceeds the 10 MB limit' : 'Invalid upload';
    return res.status(400).json({ error: message });
  }
  if (err instanceof SyntaxError && err.status === 400 && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON' });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body exceeds the 100 KB limit' });
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

if (require.main === module) {
  const PORT = process.env.PORT || 8001;
  const server = app.listen(PORT, () => {
    console.log(`RedLine backend listening on port ${PORT}`);
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      try {
        await closeOcrWorker();
        closeVoiceModels();
      } finally {
        process.exit(0);
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = app;