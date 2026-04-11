const express = require('express');
const router = express.Router();
const { createUrlLimiter } = require('../middlewares/rateLimiter');
const {
    createUrl, getAllUrls, getUrl,
    updateUrl, deleteUrl, redirectUrl
} = require('../controllers/urlController');

router.post('/', createUrlLimiter, createUrl);
router.get('/', getAllUrls);
router.get('/:shortCode', getUrl);
router.put('/:shortCode', updateUrl);
router.delete('/:shortCode', deleteUrl);

module.exports = { urlRouter: router, redirectUrl };