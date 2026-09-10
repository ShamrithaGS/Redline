let savedHistory = [];
try {
  const parsedHistory = JSON.parse(localStorage.getItem('redline-history') || '[]');
  savedHistory = Array.isArray(parsedHistory) ? parsedHistory : [];
} catch { localStorage.removeItem('redline-history'); }
const state = { history: savedHistory };
let installPrompt;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));

function saveHistory(title, type) {
  state.history.unshift({ title, type, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  state.history = state.history.slice(0, 8);
  try { localStorage.setItem('redline-history', JSON.stringify(state.history)); } catch {}
  renderHistory();
}

function renderHistory() {
  const list = $('#historyList');
  list.innerHTML = state.history.length ? state.history.map((item) => `<div class="history-entry"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.type)} · ${escapeHtml(item.time)} · on this device</small></div>`).join('') : '<div class="empty-state">No saved sessions yet.<br>Analyze an error to start your history.</div>';
}

async function getCsrfToken() {
  const cookie = document.cookie.split('; ').find((item) => item.startsWith('redline_csrf='));
  if (cookie) {
    try { return decodeURIComponent(cookie.slice('redline_csrf='.length)); } catch { document.cookie = 'redline_csrf=; Max-Age=0; Path=/'; }
  }
  await fetch('/', { credentials: 'same-origin', cache: 'no-store' });
  const refreshedCookie = document.cookie.split('; ').find((item) => item.startsWith('redline_csrf='));
  if (!refreshedCookie) return '';
  try { return decodeURIComponent(refreshedCookie.slice('redline_csrf='.length)); } catch { return ''; }
}

async function requestJson(url, body) {
  const csrfToken = await getCsrfToken();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Redline-CSRF': csrfToken }, body: JSON.stringify(body) });
  if (!response.ok) {
    let message = 'The service could not process this request.';
    try { const result = await response.json(); message = result.error || message; } catch {}
    throw new Error(message);
  }
  return response.json();
}

async function responseError(response, fallback) {
  try { const result = await response.json(); return result.error || fallback; } catch { return fallback; }
}

function setBusy(button, busy, label) { button.disabled = busy; button.querySelector('span').textContent = busy ? 'Working...' : label; }

$('#analyzeButton').addEventListener('click', async () => {
  const button = $('#analyzeButton');
  const errorText = $('#errorText').value.trim();
  if (!errorText) return;
  setBusy(button, true, 'Analyze error');
  try {
    const result = await requestJson('/api/explain-fix', { errorText, language: $('#responseLanguage').value });
    $('#analyzeResult').hidden = false;
    $('#analyzeResult').innerHTML = `<h3>What it means</h3><p>${escapeHtml(result.explanation)}</p><h3>Focused fix</h3><pre class="code">${escapeHtml(result.fix)}</pre><div class="result-meta">GEMINI ANALYSIS · ${escapeHtml($('#responseLanguage').value.toUpperCase())}</div>`;
    saveHistory(errorText.split('\n')[0].slice(0, 54), 'Error analysis');
  } catch (error) {
    $('#analyzeResult').hidden = false;
    $('#analyzeResult').innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally { setBusy(button, false, 'Analyze error'); }
});

$('#generateButton').addEventListener('click', async () => {
  const button = $('#generateButton');
  const description = $('#voiceText').value.trim();
  if (!description) return;
  setBusy(button, true, 'Generate code');
  try {
    const spokenLanguage = $('#voiceInputLanguage').selectedOptions[0].textContent;
    const result = await requestJson('/api/voice-to-logic', { description, language: spokenLanguage, codeLanguage: $('#codeLanguage').value });
    $('#voiceResult').hidden = false;
    $('#voiceResult').innerHTML = `<h3>Suggested ${escapeHtml(result.languageUsed || $('#codeLanguage').value)} function</h3><pre class="code">${escapeHtml(result.code)}</pre><div class="result-meta">GEMINI GENERATED · REVIEW BEFORE RUNNING</div>`;
    saveHistory(description.slice(0, 54), 'Voice to code');
  } catch (error) {
    $('#voiceResult').hidden = false;
    $('#voiceResult').innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally { setBusy(button, false, 'Generate code'); }
});

function setVoiceStatus(statusId, message, isError = false) {
  const status = $(`#${statusId}`);
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => Array.from(value).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([buffer], { type: 'audio/wav' });
}

function bindSpeechInput(buttonId, targetId, statusId, languageId, successMessage) {
  let audioContext;
  let processor;
  let stream;
  let samples = [];
  let recordingTimer;
  $(`#${buttonId}`).addEventListener('click', async () => {
    if ($(`#${buttonId}`).classList.contains('listening')) {
      processor.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      clearTimeout(recordingTimer);
      const sampleRate = audioContext.sampleRate;
      audioContext.close();
      $(`#${buttonId}`).classList.remove('listening');
      $(`#${buttonId}`).setAttribute('aria-label', 'Start voice input');
      setVoiceStatus(statusId, 'Transcribing...');
      const formData = new FormData();
      formData.append('audio', encodeWav(new Float32Array(samples.flat()), sampleRate), 'voice.wav');
      formData.append('language', $(`#${languageId}`).selectedOptions[0].textContent);
      try {
        const csrfToken = await getCsrfToken();
        const response = await fetch('/api/voice-input', { method: 'POST', headers: { 'X-Redline-CSRF': csrfToken }, body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Transcription failed.');
        $(`#${targetId}`).value = result.text;
        setVoiceStatus(statusId, result.text ? successMessage : 'No speech detected. Try again.', !result.text);
      } catch (error) { setVoiceStatus(statusId, `${error.message} You can type instead.`, true); }
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      samples = [];
      processor.onaudioprocess = (event) => samples.push(Array.from(event.inputBuffer.getChannelData(0)));
      source.connect(processor); processor.connect(audioContext.destination);
      $(`#${buttonId}`).classList.add('listening');
      $(`#${buttonId}`).setAttribute('aria-label', 'Stop voice input');
      setVoiceStatus(statusId, 'Listening... tap again to transcribe.');
      recordingTimer = setTimeout(() => {
        if ($(`#${buttonId}`).classList.contains('listening')) $(`#${buttonId}`).click();
      }, 30000);
    } catch (error) { setVoiceStatus(statusId, 'Microphone permission is required. You can type instead.', true); }
  });
}

bindSpeechInput('debugMicButton', 'errorText', 'debugVoiceStatus', 'debugVoiceLanguage', 'Voice captured. Review the error, then analyze it.');
bindSpeechInput('micButton', 'voiceText', 'voiceStatus', 'voiceInputLanguage', 'Voice captured. Review the text, then generate code.');

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => {
    const isActive = item === tab;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== `${tab.dataset.view}View`; view.classList.toggle('active', !view.hidden); });
}));

function setPhotoChoiceMenuState(menuId, visible) {
  const menu = document.getElementById(menuId);
  if (menu) menu.hidden = !visible;
}

setPhotoChoiceMenuState('photoChoiceMenu', false);
setPhotoChoiceMenuState('generatePhotoChoiceMenu', false);

function bindPhotoChoice(buttonId, menuId, cameraChoiceButtonId, uploadChoiceButtonId, cameraInputId, uploadInputId) {
  const photoButton = document.getElementById(buttonId);
  const menu = document.getElementById(menuId);
  const cameraChoiceButton = document.getElementById(cameraChoiceButtonId);
  const uploadChoiceButton = document.getElementById(uploadChoiceButtonId);
  const cameraInput = document.getElementById(cameraInputId);
  const uploadInput = document.getElementById(uploadInputId);

  if (!photoButton || !menu || !cameraChoiceButton || !uploadChoiceButton || !cameraInput || !uploadInput) return;

  const hideMenu = () => setPhotoChoiceMenuState(menuId, false);

  photoButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const isVisible = !menu.hidden;
    setPhotoChoiceMenuState(menuId, !isVisible);
  });

  cameraChoiceButton.addEventListener('click', () => {
    hideMenu();
    cameraInput.click();
  });

  uploadChoiceButton.addEventListener('click', () => {
    hideMenu();
    uploadInput.click();
  });

  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target) && !photoButton.contains(event.target)) {
      hideMenu();
    }
  });
}

bindPhotoChoice('photoButton', 'photoChoiceMenu', 'cameraPhotoButton', 'uploadPhotoButton', 'photoInput', 'uploadPhotoInput');
bindPhotoChoice('generatePhotoButton', 'generatePhotoChoiceMenu', 'cameraGeneratePhotoButton', 'uploadGeneratePhotoButton', 'generatePhotoInput', 'generateUploadPhotoInput');

$('#photoInput').addEventListener('change', async () => {
  const file = $('#photoInput').files[0];
  if (!file) return;
  const resultPanel = $('#analyzeResult');
  resultPanel.hidden = false;
  resultPanel.innerHTML = '<p>Reading screenshot...</p>';
  const formData = new FormData();
  formData.append('image', file);
  formData.append('language', $('#responseLanguage').value);
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/capture-fix', { method: 'POST', headers: { 'X-Redline-CSRF': csrfToken }, body: formData });
    if (!response.ok) throw new Error(await responseError(response, 'The screenshot could not be read.'));
    const result = await response.json();
    $('#errorText').value = result.extractedText || 'Screenshot captured. Add the visible error text for analysis.';
    resultPanel.innerHTML = `<h3>Screenshot captured</h3><p>${escapeHtml(result.explanation || 'Ready to analyze.')}</p><pre class="code">${escapeHtml(result.fix || '')}</pre><div class="result-meta">GEMINI VISION</div>`;
    saveHistory(file.name, 'Screenshot capture');
  } catch (error) {
    resultPanel.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally {
    $('#photoInput').value = '';
  }
});

$('#uploadPhotoInput').addEventListener('change', async () => {
  const file = $('#uploadPhotoInput').files[0];
  if (!file) return;
  const resultPanel = $('#analyzeResult');
  resultPanel.hidden = false;
  resultPanel.innerHTML = '<p>Reading uploaded screenshot...</p>';
  const formData = new FormData();
  formData.append('image', file);
  formData.append('language', $('#responseLanguage').value);
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/capture-fix', { method: 'POST', headers: { 'X-Redline-CSRF': csrfToken }, body: formData });
    if (!response.ok) throw new Error(await responseError(response, 'The uploaded screenshot could not be read.'));
    const result = await response.json();
    $('#errorText').value = result.extractedText || 'Uploaded screenshot captured. Add the visible error text for analysis.';
    resultPanel.innerHTML = `<h3>Uploaded screenshot captured</h3><p>${escapeHtml(result.explanation || 'Ready to analyze.')}</p><pre class="code">${escapeHtml(result.fix || '')}</pre><div class="result-meta">GEMINI VISION</div>`;
    saveHistory(file.name, 'Uploaded screenshot');
  } catch (error) {
    resultPanel.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally {
    $('#uploadPhotoInput').value = '';
  }
});

$('#generatePhotoInput').addEventListener('change', async () => {
  const file = $('#generatePhotoInput').files[0];
  if (!file) return;
  setVoiceStatus('voiceStatus', 'Reading screenshot for a code description...');
  const formData = new FormData();
  formData.append('image', file);
  formData.append('language', $('#voiceInputLanguage').selectedOptions[0].textContent);
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/capture-fix', { method: 'POST', headers: { 'X-Redline-CSRF': csrfToken }, body: formData });
    if (!response.ok) throw new Error(await responseError(response, 'The screenshot could not be read.'));
    const result = await response.json();
    $('#voiceText').value = result.extractedText || '';
    setVoiceStatus('voiceStatus', 'Screenshot text captured. Review it, then generate code.');
  } catch (error) {
    setVoiceStatus('voiceStatus', error.message || 'Screenshot reading failed. You can type the description instead.', true);
  } finally {
    $('#generatePhotoInput').value = '';
  }
});

$('#generateUploadPhotoInput').addEventListener('change', async () => {
  const file = $('#generateUploadPhotoInput').files[0];
  if (!file) return;
  setVoiceStatus('voiceStatus', 'Reading uploaded screenshot for a code description...');
  const formData = new FormData();
  formData.append('image', file);
  formData.append('language', $('#voiceInputLanguage').selectedOptions[0].textContent);
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/capture-fix', { method: 'POST', headers: { 'X-Redline-CSRF': csrfToken }, body: formData });
    if (!response.ok) throw new Error(await responseError(response, 'The uploaded screenshot could not be read.'));
    const result = await response.json();
    $('#voiceText').value = result.extractedText || '';
    setVoiceStatus('voiceStatus', 'Uploaded screenshot text captured. Review it, then generate code.');
  } catch (error) {
    setVoiceStatus('voiceStatus', error.message || 'Screenshot reading failed. You can type the description instead.', true);
  } finally {
    $('#generateUploadPhotoInput').value = '';
  }
});
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; });
$('#installButton').addEventListener('click', async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; } });
renderHistory();

fetch('/api/health').then((response) => response.json()).then((health) => { $('#aiLabel').textContent = health.ai === 'cloud' ? 'Cloud AI' : 'Cloud unavailable'; $('#connectionLabel').textContent = health.onlineMode ? 'Connected' : 'Needs configuration'; }).catch(() => { $('#connectionLabel').textContent = 'Connection unavailable'; });
// Service worker registration is disabled for localhost so the latest frontend updates are always loaded immediately.
