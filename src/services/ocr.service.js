const path = require('path');
const { createWorker } = require('tesseract.js');

const languagePackages = {
  English: require('@tesseract.js-data/eng'),
  Hindi: require('@tesseract.js-data/hin'),
  Tamil: require('@tesseract.js-data/tam'),
  Telugu: require('@tesseract.js-data/tel'),
};
const workerPromises = new Map();
let recognitionQueue = Promise.resolve();
let queuedJobs = 0;
const MAX_QUEUED_JOBS = 2;

function getWorker(language) {
  const languagePackage = languagePackages[language];
  if (!languagePackage) throw new Error('Unsupported OCR language');
  const languageCode = languagePackage.code;
  if (!workerPromises.has(languageCode)) {
    workerPromises.set(languageCode, createWorker(languageCode, 1, {
      langPath: process.env.TESSDATA_PATH || languagePackage.langPath || path.join(__dirname, '..', '..', 'tessdata'),
      cachePath: process.env.TESSERACT_CACHE_PATH || path.join(__dirname, '..', '..', '.ocr-cache'),
      logger: process.env.OCR_PROGRESS === 'true' ? (message) => console.log(message) : () => {},
      errorHandler: () => {},
    }));
  }
  return workerPromises.get(languageCode);
}

async function extractTextFromImage(imageBuffer, language = 'English') {
  if (queuedJobs >= MAX_QUEUED_JOBS) throw new Error('OCR service is busy; try again shortly');
  queuedJobs += 1;
  const job = recognitionQueue.then(async () => {
    const worker = await getWorker(language);
    const result = await worker.recognize(imageBuffer);
    return result.data.text.trim();
  });
  recognitionQueue = job.catch(() => {}).finally(() => { queuedJobs -= 1; });
  return job;
}

async function closeOcrWorker() {
  await recognitionQueue;
  for (const workerPromise of workerPromises.values()) {
    const worker = await workerPromise;
    await worker.terminate();
  }
  workerPromises.clear();
}

module.exports = { extractTextFromImage, closeOcrWorker };