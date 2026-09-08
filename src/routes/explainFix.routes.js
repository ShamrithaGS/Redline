const express = require('express');
const { explainFix } = require('../controllers/explainFix.controller');

const router = express.Router();
router.post('/', explainFix);

module.exports = router;