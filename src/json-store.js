const fs = require('node:fs');
const path = require('node:path');

function createJsonStore(filePath) {
	const temporaryFile = `${filePath}.tmp`;

	function read() {
		try {
			return JSON.parse(fs.readFileSync(filePath, 'utf8'));
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	}

	function write(value) {
		try {
			fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
			fs.writeFileSync(temporaryFile, JSON.stringify(value), {
				encoding: 'utf8',
				mode: 0o600
			});
			fs.renameSync(temporaryFile, filePath);
			return true;
		} catch (error) {
			console.error('[persistence] Unable to save game state:', error);
			try {
				if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
			} catch (cleanupError) {
				console.error('[persistence] Unable to remove incomplete state file:', cleanupError);
			}
			return false;
		}
	}

	return { read, write };
}

module.exports = { createJsonStore };
