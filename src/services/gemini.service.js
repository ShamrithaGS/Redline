const ai = require('../config/ai');
const { isOnlineMode } = require('../config/mode');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/**
 * Cleans and parses a JSON response from Gemini,
 * stripping any accidental markdown code fences.
 */
function parseJsonResponse(rawText) {
  const cleaned = rawText.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

function validateResult(result, fields) {
  if (!result || typeof result !== 'object' || fields.some((field) => typeof result[field] !== 'string')) throw new Error('Gemini returned an invalid response');
  return result;
}


function extractDescription(prompt) {
  const match = prompt.match(/spoke this function description out loud:\s*\n\n"([\s\S]*?)"\n\nThe description is/i);
  return match ? match[1].trim().toLowerCase() : prompt.toLowerCase();
}

function offlineCode(language, description) {
  const wantsReverse = /reverse|backwards|backward/.test(description);
  const wantsSum = /sum|total|add.*numbers/.test(description);
  const wantsUnique = /unique|duplicates|duplicate/.test(description);
  const wantsMax = /maximum|max value|largest|highest/.test(description);
  const wantsPalindrome = /palindrome/.test(description);
  const wantsRemoveEmpty = /remove|filter|empty|blank|whitespace/.test(description);
  const templates = {
    JavaScript: wantsReverse ? 'function reverseText(text) {\n  return [...text].reverse().join("");\n}' : wantsSum ? 'function sumNumbers(numbers) {\n  return numbers.reduce((total, number) => total + number, 0);\n}' : wantsUnique ? 'function uniqueItems(items) {\n  return [...new Set(items)];\n}' : wantsMax ? 'function maxNumber(numbers) {\n  return Math.max(...numbers);\n}' : wantsPalindrome ? 'function isPalindrome(text) {\n  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, "");\n  return normalized === [...normalized].reverse().join("");\n}' : wantsRemoveEmpty ? 'function removeEmptyStrings(items) {\n  return items.filter((item) => item.trim() !== "");\n}' : null,
    Python: wantsReverse ? 'def reverse_text(text):\n    return text[::-1]' : wantsSum ? 'def sum_numbers(numbers):\n    return sum(numbers)' : wantsUnique ? 'def unique_items(items):\n    return list(dict.fromkeys(items))' : wantsMax ? 'def max_number(numbers):\n    return max(numbers)' : wantsPalindrome ? 'def is_palindrome(text):\n    normalized = "".join(char.lower() for char in text if char.isalnum())\n    return normalized == normalized[::-1]' : wantsRemoveEmpty ? 'def remove_empty_strings(items):\n    return [item for item in items if item.strip()]' : null,
    TypeScript: wantsReverse ? 'function reverseText(text: string): string {\n  return [...text].reverse().join("");\n}' : wantsSum ? 'function sumNumbers(numbers: number[]): number {\n  return numbers.reduce((total, number) => total + number, 0);\n}' : wantsUnique ? 'function uniqueItems<T>(items: T[]): T[] {\n  return [...new Set(items)];\n}' : wantsRemoveEmpty ? 'function removeEmptyStrings(items: string[]): string[] {\n  return items.filter((item) => item.trim() !== "");\n}' : null,
  };
  return templates[language] || null;
}

function localTextResponse(prompt) {
  const languageMatch = prompt.match(/(?:Respond in|error in) ([^.:\"]+)/i);
  const language = languageMatch ? languageMatch[1].trim() : 'English';
  const capturedTextMatch = prompt.match(/error in [^:]+:\s*([\s\S]*)$/i) || prompt.match(/A developer photographed this error\/stack trace:\s*([\s\S]*?)\n\nRespond in/i);
  const capturedText = capturedTextMatch ? capturedTextMatch[1].trim().slice(0, 200) : '';
  if (prompt.includes('Write ONE small, focused code snippet')) {
    const languageMatch = prompt.match(/implements this in ([^.]+)\./);
    const languageUsed = languageMatch ? languageMatch[1].trim() : 'JavaScript';
    const description = extractDescription(prompt);
    const codeByLanguage = {
      Python: 'def remove_empty_strings(items):\n    return [item for item in items if item.strip()]',
      Java: 'static List<String> removeEmptyStrings(List<String> items) {\n    return items.stream().filter(item -> !item.trim().isEmpty()).toList();\n}',
      Kotlin: 'fun removeEmptyStrings(items: List<String>) = items.filter { it.isNotBlank() }',
      Swift: 'func removeEmptyStrings(_ items: [String]) -> [String] {\n    items.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }\n}',
      TypeScript: 'function removeEmptyStrings(items: string[]): string[] {\n  return items.filter((item) => item.trim() !== "");\n}',
      'C#': 'static List<string> RemoveEmptyStrings(IEnumerable<string> items) => items.Where(item => !string.IsNullOrWhiteSpace(item)).ToList();',
      Go: 'func removeEmptyStrings(items []string) []string {\n  result := []string{}\n  for _, item := range items {\n    if strings.TrimSpace(item) != "" { result = append(result, item) }\n  }\n  return result\n}',
      Rust: 'fn remove_empty_strings(items: Vec<String>) -> Vec<String> {\n    items.into_iter().filter(|item| !item.trim().is_empty()).collect()\n}',
      'C++': 'std::vector<std::string> removeEmptyStrings(const std::vector<std::string>& items) {\n  std::vector<std::string> result;\n  for (const auto& item : items) if (!item.empty()) result.push_back(item);\n  return result;\n}',
      PHP: 'function removeEmptyStrings(array $items): array {\n    return array_values(array_filter($items, fn($item) => trim($item) !== ""));\n}',
      Ruby: 'def remove_empty_strings(items)\n  items.reject { |item| item.strip.empty? }\nend',
    };
    const fallbackCode = offlineCode(languageUsed, description) || (/remove|filter|empty|blank|whitespace/.test(description) ? codeByLanguage[languageUsed] : null);
    return {
      code: fallbackCode || `// Offline mode could not safely infer this request in ${languageUsed}.\n// Connect to Gemini for a tailored implementation.`,
      languageUsed,
      offline: true,
    };
  }

  const isNullish = /null|undefined|none|nullpointer|not defined/i.test(capturedText);
  const isTypeError = /typeerror|cannot read|not a function/i.test(capturedText);
  const isIndexError = /indexerror|out of range|array index/i.test(capturedText);
  const explanation = isTypeError ? 'The code is using a value as the wrong type or calling an operation that the value does not support.' : isIndexError ? 'The code is accessing a position outside the available collection range.' : isNullish ? 'The code is using a missing value before checking that it exists.' : 'This error needs the original stack trace and surrounding code for a reliable offline diagnosis.';
  const fix = isTypeError ? 'if (typeof value !== "expectedType") {\n  return; // handle the unexpected type\n}\nuse(value);' : isIndexError ? 'if (index < 0 || index >= items.length) {\n  return; // handle the invalid index\n}\nuse(items[index]);' : isNullish ? 'if (value == null) {\n  return; // handle the missing value\n}\nuse(value);' : '// Add the full stack trace and the failing function for a focused fix.';
  return {
    explanation: language === 'Hindi' ? `कैप्चर किया गया संदेश: ${capturedText || 'कोई संदेश नहीं मिला'}। ${explanation}` : language === 'Tamil' ? `படத்தில் கிடைத்த செய்தி: ${capturedText || 'செய்தி இல்லை'}. ${explanation}` : language === 'Telugu' ? `చిత్రం నుంచి పొందిన సందేశం: ${capturedText || 'సందేశం లేదు'}. ${explanation}` : `Captured error: ${capturedText || 'No error text was detected'}. ${explanation}`,
    fix,
    offline: true,
  };
}

function localImageResponse() {
  return {
    extractedText: 'Offline preview: add a typed error message to analyze this screenshot.',
    explanation: 'RedLine is offline, so this preview cannot run OCR on the image yet. Type or paste the visible error to get an on-device style result.',
    fix: 'Copy the error text into the Analyze tab, then run the check again when the device is online.',
    offline: true,
  };
}

/**
 * Sends a text-only prompt to Gemini and returns parsed JSON.
 */
async function generateTextJson(prompt) {
  if (!isOnlineMode()) throw new Error('Cloud AI is not configured. Set ONLINE_MODE=true and GEMINI_API_KEY.');

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return validateResult(parseJsonResponse(response.text), prompt.includes('Write ONE small') ? ['code', 'languageUsed'] : ['explanation', 'fix']);
  } catch (error) {
    console.error(`Gemini request failed: ${error.message}`);
    throw new Error('Cloud AI request failed');
  }
}

/**
 * Sends a prompt + image to Gemini and returns parsed JSON.
 */
async function generateImageJson(prompt, base64Image, mimeType) {
  if (!isOnlineMode()) throw new Error('Cloud AI is not configured. Set ONLINE_MODE=true and GEMINI_API_KEY.');

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
    });
    return validateResult(parseJsonResponse(response.text), ['extractedText', 'explanation', 'fix']);
  } catch (error) {
    console.error(`Gemini image request failed: ${error.message}`);
    throw new Error('Cloud AI request failed');
  }
}

module.exports = { generateTextJson, generateImageJson };