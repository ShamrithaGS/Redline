const { generateTextJson } = require('../services/gemini.service');
const { supportedResponseLanguages, readText, readChoice } = require('../config/validation');

async function explainFix(req, res) {
  try {
    const { errorText, language } = req.body || {};

    const text = readText(errorText, 'errorText');
    if (text.error) return res.status(400).json({ error: text.error });
    const selectedLanguage = readChoice(language, 'response language', supportedResponseLanguages, 'English');
    if (selectedLanguage.error) return res.status(400).json({ error: selectedLanguage.error });

    const prompt = `You are RedLine, a debugging assistant for developers who only have their phone available (laptop is locked).
A developer photographed this error/stack trace:

"${text.value}"

Respond in ${selectedLanguage.value}.
1. Explain in plain, simple language why this error is happening (2-3 sentences max).
2. Suggest ONE small, focused code fix (single function or few lines only, not a full rewrite).

Respond in this exact JSON format, no markdown, no backticks:
{"explanation": "...", "fix": "..."}`;

    const result = await generateTextJson(prompt);
    res.json(result);

  } catch (err) {
    console.error(err);
    if (err.message.startsWith('Cloud AI')) return res.status(503).json({ error: err.message });
    res.status(500).json({ error: 'Failed to process error text' });
  }
}

module.exports = { explainFix };