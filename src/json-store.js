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

	async function writeAsync(value) {
		try {
			await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
			await fs.promises.writeFile(temporaryFile, JSON.stringify(value), {
				encoding: 'utf8',
				mode: 0o600
			});
			await fs.promises.rename(temporaryFile, filePath);
			return true;
		} catch (error) {
			console.error('[persistence] Unable to save game state (async):', error);
			try {
				if (fs.existsSync(temporaryFile)) await fs.promises.unlink(temporaryFile);
			} catch (cleanupError) {
				console.error('[persistence] Unable to remove incomplete state file:', cleanupError);
			}
			return false;
		}
	}

	return { read, write, writeAsync };
}

module.exports = { createJsonStore };
