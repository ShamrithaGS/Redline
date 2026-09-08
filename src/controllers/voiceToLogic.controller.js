const { generateTextJson } = require('../services/gemini.service');
const { supportedCodeLanguages, supportedVoiceLanguages, readText, readChoice } = require('../config/validation');

async function voiceToLogic(req, res) {
  try {
    const { description, language, codeLanguage } = req.body || {};

    const text = readText(description, 'description');
    if (text.error) return res.status(400).json({ error: text.error });
    const spokenLanguage = readChoice(language, 'voice language', supportedVoiceLanguages, 'English');
    if (spokenLanguage.error) return res.status(400).json({ error: spokenLanguage.error });
    const targetLanguage = readChoice(codeLanguage, 'code language', supportedCodeLanguages, 'JavaScript');
    if (targetLanguage.error) return res.status(400).json({ error: targetLanguage.error });

    const prompt = `You are RedLine, a coding assistant helping a developer who only has their phone available (laptop locked).
The developer spoke this function description out loud:

"${text.value}"

The description is in ${spokenLanguage.value}. Write ONE small, focused code snippet (a single function) that implements this in ${targetLanguage.value}.
Keep it short and correct, no extra explanation text, just clean commented code.

Respond in this exact JSON format, no markdown, no backticks:
{"code": "...", "languageUsed": "..."}`;

    const result = await generateTextJson(prompt);
    res.json(result);

  } catch (err) {
    console.error(err);
    if (err.message.startsWith('Cloud AI')) return res.status(503).json({ error: err.message });
    res.status(500).json({ error: 'Failed to generate code' });
  }
}

module.exports = { voiceToLogic };