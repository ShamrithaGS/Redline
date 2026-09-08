const express = require('express');
const upload = require('../middleware/upload');
const { transcribeVoice } = require('../controllers/voiceInput.controller');

const router = express.Router();
router.post('/', upload.single('audio'), transcribeVoice);

module.exports = router;