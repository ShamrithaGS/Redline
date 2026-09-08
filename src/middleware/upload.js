const multer = require('multer');

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024, files: 1, parts: 3 },
	fileFilter: (req, file, callback) => {
		const allowed = file.mimetype.startsWith('image/') || file.mimetype === 'audio/wav' || file.mimetype === 'audio/x-wav';
		callback(allowed ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), allowed);
	},
});

module.exports = upload;