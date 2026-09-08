# RedLine — Offline Debugging Bridge

Phone-only debugging bridge. Deployable web app and backend service that powers RedLine's AI flows:
capturing an error, explaining it, and drafting a fix — or turning a spoken
function description into code.

Built for iQOO Hackathon 2026, City Battles — Chennai. Team Altos. The browser demo is a phone-shaped PWA, and the same API can be used by a native Android client or any future mobile shell.

## Tech Stack

- Node.js + Express
- Google Gemini API for reasoning, explanation, and code generation when `GEMINI_API_KEY` is configured
- Multer for image upload handling
- Vanilla PWA frontend with service-worker caching, local Tesseract.js OCR, Vosk offline voice recognition, and deterministic offline AI fallback

## Setup

1. Install dependencies:

	```bash
	npm install
	```

2. Create a `.env` file with `GEMINI_API_KEY=...`, `ONLINE_MODE=true`, and, if needed, `GEMINI_MODEL=...`. RedLine requires Gemini cloud access for debugging, screenshot analysis, and code generation. For a deployed API, set `REDLINE_API_KEY` and `CORS_ORIGIN`.

3. Start the app:

	```bash
	npm start
	```

Open `http://localhost:8001`. The app requires internet access and a Gemini API key. Restart the server after changing environment variables.

## API

- `POST /api/explain-fix` with `{ "errorText": "...", "language": "English" }`
- `POST /api/capture-fix` with multipart `image` and optional `language`
- `POST /api/voice-to-logic` with `{ "description": "...", "language": "English", "codeLanguage": "Python" }`
- `POST /api/voice-input` with multipart `audio` (mono 16-bit PCM WAV) and `language` (`English` or `Hindi`)
- `GET /api/health` reports whether cloud mode is ready and remains public for health probes. Other `/api/*` routes require `X-Redline-API-Key` when `REDLINE_API_KEY` is configured.

Uploads are limited to 10 MB and voice recordings to 60 seconds on the server (the browser stops recording after 30 seconds). When `REDLINE_API_KEY` is configured, external API clients must include the `X-Redline-API-Key` header; the bundled browser UI uses a same-origin CSRF cookie instead. API requests are rate-limited per client. Set `TRUST_PROXY=true` only when running behind a trusted reverse proxy.

The UI supports common programming languages and regional response languages. Screenshot analysis and code generation use Gemini cloud AI. Voice recording is encoded locally as WAV and transcribed by the bundled Vosk English or Hindi model before being sent to the code-generation flow. The interface uses local font fallbacks.

Both Debug and Generate support the same three input modes: type text, capture a photo for OCR, or tap the microphone for offline speech-to-text. Debug additionally selects the explanation language; Generate selects the spoken input language and target programming language independently. Microphone permission is still required to capture audio, but recognition runs locally through Vosk after recording. English and Hindi Vosk models are bundled; unsupported spoken languages explain that the model is not installed yet.

## Tests

Run the automated API behavior tests with:

```bash
npm test
```

The suite covers health status, offline error explanation, requested code language, input validation, and screenshot validation.