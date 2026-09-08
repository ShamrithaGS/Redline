const supportedResponseLanguages = new Set(['English', 'Hindi', 'Tamil', 'Telugu']);
const supportedVoiceLanguages = new Set(['English', 'Hindi']);
const supportedCodeLanguages = new Set(['JavaScript', 'Python', 'Java', 'Kotlin', 'Swift', 'TypeScript', 'C#', 'Go', 'Rust', 'C++', 'PHP', 'Ruby']);

function readText(value, field, maxLength = 10000) {
  if (typeof value !== 'string' || !value.trim()) return { error: `${field} is required` };
  if (value.length > maxLength) return { error: `${field} must be ${maxLength} characters or fewer` };
  return { value: value.trim() };
}

function readChoice(value, field, supported, fallback) {
  const selected = value === undefined ? fallback : value;
  if (typeof selected !== 'string' || !supported.has(selected)) return { error: `Unsupported ${field}` };
  return { value: selected };
}

module.exports = { supportedResponseLanguages, supportedVoiceLanguages, supportedCodeLanguages, readText, readChoice };
