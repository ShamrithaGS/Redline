const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { apiProtection, issueCsrfCookie } = require('../src/middleware/security');
const { transcribeWav } = require('../src/services/voice.service');
const { generateTextJson } = require('../src/services/gemini.service');
const { explainFix } = require('../src/controllers/explainFix.controller');
const { voiceToLogic } = require('../src/controllers/voiceToLogic.controller');

process.env.GEMINI_API_KEY = '';
const app = require('../src/server');

function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const requestOptions = { ...options, port: server.address().port };
    const clientRequest = http.request(requestOptions, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(responseBody) }));
    });
    clientRequest.on('error', reject);
    if (body) clientRequest.write(body);
    clientRequest.end();
  });
}

test('health reports unavailable cloud mode without an API key', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const result = await request(server, { method: 'GET', path: '/api/health' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ai, 'cloud-unavailable');
  assert.equal(result.body.onlineMode, false);
});

test('explain-fix requires cloud configuration', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const body = JSON.stringify({ errorText: 'NullPointerException', language: 'English' });
  const result = await request(server, { method: 'POST', path: '/api/explain-fix', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /Cloud AI is not configured/);
});

test('voice-to-logic requires cloud configuration', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const body = JSON.stringify({ description: 'Remove empty strings', codeLanguage: 'Python', language: 'Hindi' });
  const result = await request(server, { method: 'POST', path: '/api/voice-to-logic', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /Cloud AI is not configured/);
});

test('explain-fix validates required input', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const body = JSON.stringify({ language: 'English' });
  const result = await request(server, { method: 'POST', path: '/api/explain-fix', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'errorText is required');
});

test('capture-fix validates required image input', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const result = await request(server, { method: 'POST', path: '/api/capture-fix' });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'image file is required');
});

test('voice-input validates required audio input', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const result = await request(server, { method: 'POST', path: '/api/voice-input' });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'audio file is required');
});

test('malformed JSON returns a JSON error', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const result = await request(server, { method: 'POST', path: '/api/explain-fix', headers: { 'Content-Type': 'application/json' } }, '{');
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Request body must be valid JSON');
});

test('explain-fix rejects non-string input', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const body = JSON.stringify({ errorText: { message: 'x' } });
  const result = await request(server, { method: 'POST', path: '/api/explain-fix', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'errorText is required');
});

test('voice-to-logic rejects unsupported code languages', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const body = JSON.stringify({ description: 'Do something', codeLanguage: 'Cobol' });
  const result = await request(server, { method: 'POST', path: '/api/voice-to-logic', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Unsupported code language');
});

test('unknown API routes return JSON', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  const result = await request(server, { method: 'GET', path: '/api/missing' });
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'API route not found');
});

test('API key protects the first request', () => {
  const previousKey = process.env.REDLINE_API_KEY;
  process.env.REDLINE_API_KEY = 'test-key';
  let status;
  let called = false;
  const request = { ip: `first-request-${Date.now()}`, socket: {}, get: () => undefined };
  const response = {
    status(code) { status = code; return this; },
    json() { return this; },
    set() { return this; },
  };
  try {
    apiProtection(request, response, () => { called = true; });
    assert.equal(status, 401);
    assert.equal(called, false);
  } finally {
    process.env.REDLINE_API_KEY = previousKey;
  }
});

test('non-PCM WAV audio is rejected', () => {
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(3, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  assert.throws(() => transcribeWav(wav), /mono 16-bit PCM WAV/);
});

test('same-origin CSRF token can authenticate browser requests', () => {
  const previousKey = process.env.REDLINE_API_KEY;
  process.env.REDLINE_API_KEY = 'test-key';
  let status;
  let called = false;
  const token = 'csrf-token';
  const request = {
    ip: `csrf-request-${Date.now()}`,
    protocol: 'http',
    socket: {},
    get(name) {
      if (name === 'origin') return 'http://localhost:8001';
      if (name === 'host') return 'localhost:8001';
      if (name === 'cookie') return `redline_csrf=${token}`;
      if (name === 'x-redline-csrf') return token;
      return undefined;
    },
  };
  const response = {
    status(code) { status = code; return this; },
    json() { return this; },
    set() { return this; },
  };
  try {
    apiProtection(request, response, () => { called = true; });
    assert.equal(status, undefined);
    assert.equal(called, true);
  } finally {
    process.env.REDLINE_API_KEY = previousKey;
  }
});

test('malformed CSRF cookies do not throw', () => {
  let continued = false;
  const request = { get(name) { return name === 'cookie' ? 'redline_csrf=%ZZ' : undefined; } };
  issueCsrfCookie(request, { set() {} }, () => { continued = true; });
  assert.equal(continued, true);
});

test('text generation requires cloud configuration', async () => {
  await assert.rejects(() => generateTextJson('Generate a function in Python.'), /Cloud AI is not configured/);
});

test('HTTPS CSRF cookies are marked Secure', () => {
  let cookie;
  const request = { secure: true, get: () => undefined };
  issueCsrfCookie(request, { set(name, value) { if (name === 'Set-Cookie') cookie = value; } }, () => {});
  assert.match(cookie, /; Secure$/);
});

test('empty JSON body returns validation errors', async () => {
  const results = [];
  const response = { status(code) { this.code = code; return this; }, json(body) { results.push({ code: this.code, body }); } };
  await explainFix({ body: undefined }, response);
  await voiceToLogic({ body: undefined }, response);
  assert.deepEqual(results, [
    { code: 400, body: { error: 'errorText is required' } },
    { code: 400, body: { error: 'description is required' } },
  ]);
});

