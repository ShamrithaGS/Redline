const { transcribeWav } = require('../services/voice.service');
const { supportedVoiceLanguages, readChoice } = require('../config/validation');

async function transcribeVoice(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio file is required' });
    const language = req.body.language || 'English';
    const selectedLanguage = readChoice(language, 'voice language', supportedVoiceLanguages, 'English');
    if (selectedLanguage.error) return res.status(400).json({ error: selectedLanguage.error });
    const text = transcribeWav(req.file.buffer, selectedLanguage.value);
    res.json({ text, language: selectedLanguage.value, engine: 'Vosk' });
  } catch (error) {
    if (error.message.startsWith('Voice audio must')) return res.status(400).json({ error: error.message });
    if (error.message === 'Voice recording must be 60 seconds or shorter') return res.status(400).json({ error: error.message });
    res.status(503).json({ error: 'Voice transcription service is unavailable' });
  }
}

module.exports = { transcribeVoice };