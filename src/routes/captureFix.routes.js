const express = require('express');
const upload = require('../middleware/upload');
const { captureFix } = require('../controllers/captureFix.controller');

const router = express.Router();
router.post('/', upload.single('image'), captureFix);

module.exports = router;