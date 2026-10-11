const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createCollectionMapRouter({
	express,
	dataDir,
	isAdminSessionToken,
	hasCollection,
	getCollectionMap,
	setCollectionMap,
	deleteCollectionMap,
	persistState,
	getCollectionMapUrl,
	removeCollectionMapFile,
	onChange
}) {
	const router = express.Router();

	router.get('/maps/:collectionId', (req, res) => {
		const map = getCollectionMap(req.params.collectionId);
		if (!map) return res.sendStatus(404);
		const mapPath = path.join(dataDir, 'maps', map.filename);
		if (!fs.existsSync(mapPath)) return res.sendStatus(404);
		res.set({
			'Cache-Control': 'no-store',
			'Content-Type': map.mimeType,
			'X-Content-Type-Options': 'nosniff'
		});
		res.sendFile(mapPath, error => {
			if (error && !res.headersSent) {
				console.error('[maps] Unable to serve collection map:', error);
				res.sendStatus(500);
			}
		});
	});

	router.post('/admin/collections/:collectionId/map', express.raw({
		type: ['image/jpeg', 'image/png', 'image/webp'],
		limit: '10mb'
	}), (req, res) => {
		if (!isAdminSessionToken(req.get('authorization'))) {
			return res.status(401).json({ ok: false, error: 'unauthorized' });
		}
		const collectionId = req.params.collectionId;
		if (!hasCollection(collectionId)) {
			return res.status(404).json({ ok: false, error: 'collection-not-found' });
		}
		const image = getSupportedImage(req.body, req.get('content-type'));
		if (!image) return res.status(415).json({ ok: false, error: 'unsupported-image' });

		const filename = `${crypto.randomBytes(16).toString('hex')}.${image.extension}`;
		const mapsDirectory = path.join(dataDir, 'maps');
		const temporaryPath = path.join(mapsDirectory, `${filename}.tmp`);
		const finalPath = path.join(mapsDirectory, filename);
		const previousMap = getCollectionMap(collectionId);
		try {
			fs.mkdirSync(mapsDirectory, { recursive: true, mode: 0o700 });
			fs.writeFileSync(temporaryPath, image.bytes, { mode: 0o600, flag: 'wx' });
			fs.renameSync(temporaryPath, finalPath);
			setCollectionMap(collectionId, { filename, mimeType: image.mimeType });
			if (!persistState()) {
				restoreCollectionMap(collectionId, previousMap, deleteCollectionMap, setCollectionMap);
				fs.unlinkSync(finalPath);
				return res.status(500).json({ ok: false, error: 'persistence-unavailable' });
			}
			if (previousMap) removeCollectionMapFile(previousMap);
			onChange();
			res.json({ ok: true, mapUrl: getCollectionMapUrl(collectionId) });
		} catch (error) {
			if (getCollectionMap(collectionId)?.filename === filename) {
				restoreCollectionMap(collectionId, previousMap, deleteCollectionMap, setCollectionMap);
			}
			for (const filePath of [temporaryPath, finalPath]) {
				try {
					if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
				} catch (cleanupError) {
					console.error('[maps] Unable to clean up uploaded map:', cleanupError);
				}
			}
			console.error('[maps] Unable to store collection map:', error);
			if (!res.headersSent) res.status(500).json({ ok: false, error: 'persistence-unavailable' });
		}
	});

	router.delete('/admin/collections/:collectionId/map', (req, res) => {
		if (!isAdminSessionToken(req.get('authorization'))) {
			return res.status(401).json({ ok: false, error: 'unauthorized' });
		}
		const collectionId = req.params.collectionId;
		const previousMap = getCollectionMap(collectionId);
		if (!previousMap) return res.status(404).json({ ok: false, error: 'map-not-found' });
		deleteCollectionMap(collectionId);
		if (!persistState()) {
			setCollectionMap(collectionId, previousMap);
			return res.status(500).json({ ok: false, error: 'persistence-unavailable' });
		}
		removeCollectionMapFile(previousMap);
		onChange();
		res.json({ ok: true });
	});

	return router;
}

function restoreCollectionMap(collectionId, map, deleteCollectionMap, setCollectionMap) {
	if (map) setCollectionMap(collectionId, map);
	else deleteCollectionMap(collectionId);
}

function getSupportedImage(body, contentType) {
	if (!Buffer.isBuffer(body) || body.length === 0) return null;
	if (contentType === 'image/jpeg' &&
		body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
		return { bytes: body, extension: 'jpg', mimeType: contentType };
	}
	if (contentType === 'image/png' &&
		body.length >= 8 &&
		body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return { bytes: body, extension: 'png', mimeType: contentType };
	}
	if (contentType === 'image/webp' &&
		body.length >= 12 &&
		body.toString('ascii', 0, 4) === 'RIFF' &&
		body.toString('ascii', 8, 12) === 'WEBP') {
		return { bytes: body, extension: 'webp', mimeType: contentType };
	}
	return null;
}

module.exports = { createCollectionMapRouter };
