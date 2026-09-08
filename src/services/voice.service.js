const fs = require('fs');
const os = require('os');
const path = require('path');
const { Model, Recognizer } = require('vosk-koffi');

const modelPaths = {
  English: process.env.VOSK_MODEL_PATH || path.join(__dirname, '..', '..', 'models', 'vosk-model-small-en-us-0.15'),
  Hindi: process.env.VOSK_HINDI_MODEL_PATH || path.join(__dirname, '..', '..', 'models', 'vosk-model-small-hi-0.22'),
};
const models = new Map();

function getModel(language) {
  if (!modelPaths[language]) throw new Error(`Voice recognition is not bundled for ${language} yet. Choose English or Hindi.`);
  const modelPath = modelPaths[language];
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Vosk model not found at ${modelPath}`);
  }
  if (!models.has(language)) models.set(language, new Model(modelPath));
  return models.get(language);
}

function readWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Voice audio must be a WAV file');
  }
  let offset = 12;
  let sampleRate;
  let channels;
  let bitsPerSample;
  let audioFormat;
  let audioStart;
  let audioLength;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + chunkSize > buffer.length) throw new Error('Voice audio must be a valid WAV file');
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('Voice audio must be a valid WAV file');
      audioFormat = buffer.readUInt16LE(offset + 8);
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      audioStart = offset + 8;
      audioLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!audioStart || !sampleRate || audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) throw new Error('Voice audio must be mono 16-bit PCM WAV');
  if (audioLength > buffer.length - audioStart) throw new Error('Voice audio must be a valid WAV file');
  return { sampleRate, audio: buffer.subarray(audioStart, audioStart + audioLength) };
}

function transcribeWav(buffer, language = 'English') {
  const { sampleRate, audio } = readWav(buffer);
  if (audio.length / (sampleRate * 2) > 60) throw new Error('Voice recording must be 60 seconds or shorter');
  const recognizer = new Recognizer({ model: getModel(language), sampleRate });
  let result;
  try {
    recognizer.acceptWaveform(audio);
    result = recognizer.finalResult();
  } finally {
    recognizer.free();
  }
  const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
  return parsedResult.text.trim();
}

function closeVoiceModels() {
  for (const model of models.values()) model.free();
  models.clear();
}

module.exports = { transcribeWav, modelPaths, closeVoiceModels };