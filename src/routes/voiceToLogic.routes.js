const express = require('express');
const { voiceToLogic } = require('../controllers/voiceToLogic.controller');

const router = express.Router();
router.post('/', voiceToLogic);

module.exports = router;