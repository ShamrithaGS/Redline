const { generateImageJson } = require('../services/gemini.service');
const { supportedResponseLanguages } = require('../config/validation');
const { detectImageMime } = require('../services/fileValidation.service');

async function captureFix(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image file is required' });
    }

    const language = req.body.language || 'English';
    if (!supportedResponseLanguages.has(language)) return res.status(400).json({ error: 'Unsupported response language' });
    const detectedMimeType = detectImageMime(req.file.buffer);
    if (!detectedMimeType) return res.status(400).json({ error: 'image file must be a valid image' });
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = detectedMimeType;

    const prompt = `You are RedLine, a debugging assistant for developers who only have their phone available (laptop is locked).
This image is a photo of an error or stack trace shown on a laptop screen.

1. Read the exact error text from the image.
2. Respond in ${language}.
3. Explain in plain, simple language why this error is happening (2-3 sentences max).
4. Suggest ONE small, focused code fix (single function or few lines only, not a full rewrite).

Respond in this exact JSON format, no markdown, no backticks:
{"extractedText": "...", "explanation": "...", "fix": "..."}`;

    const result = await generateImageJson(prompt, base64Image, mimeType);
    res.json(result);

  } catch (err) {
    console.error(err);
    if (err.message === 'OCR service is busy; try again shortly') return res.status(503).json({ error: err.message });
    if (err.message.startsWith('Cloud AI')) return res.status(503).json({ error: err.message });
    res.status(500).json({ error: 'Failed to process image' });
  }
}

module.exports = { captureFix };