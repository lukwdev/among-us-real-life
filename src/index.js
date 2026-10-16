const PORT = process.env.PORT || 4046;

const express = require('express');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const _ = require('lodash');
const path = require('path');
const { Server } = require('socket.io');
const webPush = require('web-push');
const { createCollectionMapRouter } = require('./collection-map-router');
const { createGameProgress } = require('./game-progress');
const { hasImpostorVictory, hasCrewmateVictory } = require('./game-outcome');
const { createJsonStore } = require('./json-store');
const { createPushNotifier } = require('./push-notifications');

function normalizeTask(task, index = 0) {
	if (typeof task === 'string') {
		const match = /^(.*)\s+\(([^()]*)\)$/.exec(task.trim());
		return {
			id: `legacy-${index}-${crypto.createHash('sha1').update(task).digest('hex').slice(0, 10)}`,
			label: (match ? match[1] : task).trim(),
			room: match ? match[2].trim() : '',
			type: 'manual'
		};
	}
	const normalized = {
		id: typeof task?.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(task.id)
			? task.id
			: crypto.randomUUID(),
		label: typeof task?.label === 'string' ? task.label.trim() : '',
		room: typeof task?.room === 'string' ? task.room.trim() : '',
		type: ['manual', 'qr', 'isbn'].includes(task?.type) ? task.type : 'manual'
	};
	if (normalized.type === 'qr') {
		normalized.qrCodes = Array.isArray(task.qrCodes)
			? task.qrCodes.filter(code => typeof code === 'string').map(code => code.trim()).filter(Boolean)
			: [];
	}
	if (normalized.type === 'isbn') normalized.isbnCount = Math.max(1, Math.floor(Number(task.isbnCount) || 1));
	return normalized;
}

function isValidTask(task) {
	if (typeof task === 'string') return task.trim().length > 0 && task.trim().length <= 200;
	const normalized = normalizeTask(task);
	return isRecord(task) &&
		typeof normalized.label === 'string' &&
		normalized.label.length > 0 &&
		normalized.label.length <= 200 &&
		normalized.room.length <= 64 &&
		(normalized.type !== 'qr' || (normalized.qrCodes.length >= 1 && normalized.qrCodes.length <= 20)) &&
		(normalized.type !== 'isbn' || normalized.isbnCount <= 1000);
}

function taskKey(task) {
	return task.id || `${task.type}:${task.label}:${task.room}`;
}

function taskDisplayLabel(task) {
	if (!task) return 'Unknown task';
	return task.room ? `${task.label} (${task.room})` : task.label;
}

function normalizeIsbn(value) {
	return value.replace(/[-\s]/g, '').toUpperCase();
}

function isValidIsbn(value) {
	const isbn = normalizeIsbn(value);
	if (/^\d{9}[\dX]$/.test(isbn)) {
		let sum = 0;
		for (let i = 0; i < 10; i += 1) sum += (isbn[i] === 'X' ? 10 : Number(isbn[i])) * (10 - i);
		return sum % 11 === 0;
	}

	if (/^\d{13}$/.test(isbn)) {
		const sum = isbn.slice(0, 12).split('').reduce((total, digit, index) =>
			total + Number(digit) * (index % 2 ? 3 : 1), 0);
		return (10 - (sum % 10)) % 10 === Number(isbn[12]);
	}
	return false;
}

const isbnCache = new Map();

async function lookupBookMetadata(isbn) {
	const normalized = normalizeIsbn(isbn);
	if (isbnCache.has(normalized)) {
		return isbnCache.get(normalized);
	}
	try {
		const response = await fetch(
			`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(normalized)}&format=json&jscmd=data`,
			{
				headers: { Accept: 'application/json', 'User-Agent': 'among-us-real-life/1.0' },
				signal: AbortSignal.timeout(5000)
			}
		);
		if (!response.ok) {
			isbnCache.set(normalized, null);
			return null;
		}
		const data = await response.json();
		const book = data[`ISBN:${normalized}`];
		if (!book) {
			isbnCache.set(normalized, null);
			return null;
		}
		const metadata = {
			title: typeof book.title === 'string' ? book.title : '',
			authors: Array.isArray(book.authors)
				? book.authors.map(author => author.name).filter(Boolean).join(', ')
				: ''
		};
		if (isbnCache.size > 500) {
			const oldestKey = isbnCache.keys().next().value;
			isbnCache.delete(oldestKey);
		}
		isbnCache.set(normalized, metadata);
		return metadata;
	} catch {
		return null;
	}
}

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const adminCode = process.env.ADMIN_CODE;
let playerJoinCode = typeof process.env.PLAYER_JOIN_CODE === 'string'
	? process.env.PLAYER_JOIN_CODE.trim()
	: '';
const playerJoinCodeRequired = process.env.PLAYER_AUTH_REQUIRED !== 'false';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const pushSubject = process.env.PUSH_SUBJECT || 'mailto:admin@example.com';
const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);

if (!adminCode) {
	console.error('[config] ADMIN_CODE is not set; admin access is disabled');
}
if (Boolean(vapidPublicKey) !== Boolean(vapidPrivateKey)) {
	throw new Error('Both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together');
}
if (pushEnabled) {
	webPush.setVapidDetails(pushSubject, vapidPublicKey, vapidPrivateKey);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: process.env.CORS_ORIGIN
			? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
			: false,
		methods: ['GET', 'POST']
	}
});

const TASKS = [
	// 'Flip the light bulbs on or off (THE DOME)',
	// 'Set the A/C to 16 or 20 (THE DOME)',
	// 'Start a fire (wait 20 seconds at the fire) (FIRE PIT)',
	// 'Sit at picnic bench (30 seconds) (OUTSIDE)',
	// 'Sit in the sauna (wait 30 seconds) (SAUNA)',
	// 'Shoot cans (picnic tables) (reset)',
	// 'Put the hose back (reset) (THE SHED)',
	// 'Pump the bike pump 5 times (THE PORCH)',
	// 'Sweep the whole porch (THE PORCH)',
	'Build a house of cards (2 layers) (LIVING FIRST FLOOR)',
	'Get ring on the hook (DINING)',
	'Flip the light switch on or off (LIVING FIRST FLOOR)',
	// 'Wash your hands (KITCHEN)',
	'Fill 3 cups of water (KITCHEN)',
	'Climb the bunkbed (BR3)',
	'Hide in the closet (30 seconds) (BR3)',
	'Flip both light switches (BR2)',
	'Open/Close curtains (BR2)',
	'Flip both light switches (BR1)',
	'Flush the toilet (BATH 1st Floor)',
	'Wash your handss (BATH 1st Floor)',
	'Set thermostat to 25 and 20 then 23 (1st floor hallway)',
	'Put on life jacket and take off (basement stairs)',
	'Pick up and put snowshoe on the shelf (STORAGE)',
	// 'Turn lamp switch on or off (BR4)',
	'Climb bunch bed (BR4)',
	'Hide in closet (30 seconds) (BR4)',
	'Flush toilet (BATH basement)',
	'Wash hands (BATH basement)',
	'Serve a ping pong (LIVING basement)',
	'Flip lamp on off (LIVING basement)',
	'Set A/C to 50 and 60 and 67 and turn off (LIVING basement)',
	// 'Fix the satellite dish (30 seconds) (OUTSIDE front)',
	// '2 Ball in hoop (OUTSIDE front)',
	// 'Fix car engine BMW(30 seconds) (outside front)',
	// 'Fix car engine CX-30(30 seconds) (outside front)',
	// 'Put BBQ fork in bag (reset) (FRONT DECK)'
];
const N_TASKS = 5;
const N_IMPOSTORS = 1;
const DEFAULT_TASKS_PER_PLAYER = N_TASKS;

let taskProgress = Object.create(null);
let isMeeting = false;
let isGameActive = false;
const DEFAULT_TASK_COLLECTION_ID = 'default';
let taskCollections = [{
	id: DEFAULT_TASK_COLLECTION_ID,
	name: 'Standard',
	tasks: TASKS.map(normalizeTask)
}];
let selectedTaskCollectionId = DEFAULT_TASK_COLLECTION_ID;
let gameConfig = {
	tasks: TASKS.map(normalizeTask),
	numImpostors: N_IMPOSTORS,
	numTasksPerPlayer: DEFAULT_TASKS_PER_PLAYER,
	emergencyCooldownMinutes: 1,
	killCooldownSeconds: 20,
	// Max number of players that can receive the same task label
	maxPlayersPerTask: 2,
	// New: sabotage duration in seconds
	sabotageDurationSeconds: 60,
	// New: shared sabotage charges for all impostors
	sabotageCharges: 2,
	// 'button' keeps the existing system; 'qr' requires two configured QR values.
	sabotageMode: 'button',
	sabotageQrCodes: [],
	// Delay between automatic completion of tasks belonging to dead crewmates
	deadTaskCompletionIntervalSeconds: 90
};
let emergencyCooldownEndMs = 0;
let lastMeetingType = null; // 'emergency' | 'report' | null
let meetingCaller = null; // { id: string, name: string, type: 'emergency' | 'report' } | null
let meetingVotes = Object.create(null); // voterAuth -> targetAuth | 'skip'
let meetingResults = null; // { tallies: ..., votes: ..., ejected: ..., ejectedName: ..., tie: boolean } | null
let impostorCompletedTasksByAuth = Object.create(null); // auth -> { [taskId]: boolean }
let impostorIds = new Set();
let killCooldownEndMsBySocketId = {};
// Auth-based mappings for reconnect/rehydration
let socketIdToAuth = {};
let authToPlayer = Object.create(null); // auth -> { role: string, tasks: { [taskId]: label } }
let taskActivityByAuth = Object.create(null);
let taskActionProgressByAuth = Object.create(null);
let bookIsbns = Object.create(null);
let gameLog = [];
let impostorAuths = new Set();
let killCooldownEndMsByAuth = Object.create(null);
// Sabotage state
let isSabotageActive = false;
let sabotageEndMs = 0;
let sabotageTimeout = null;
let sabotageUsedAuths = new Set();
let sabotageChargesRemaining = 0;
let sabotageDefuserAuths = new Set();

let deadAuths = new Set();
let deadTaskNextCompletionAtByAuth = Object.create(null);
const deadTaskCompletionTimers = new Map();
let gameWinner = null;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'game-state.json');
const stateStore = createJsonStore(STATE_FILE);
let playerDirectory = Object.create(null);
let pushSubscriptions = Object.create(null);
let adminSessions = Object.create(null);
let collectionMaps = Object.create(null);
const ADMIN_SESSION_DURATION_MS = Math.max(
	1,
	parseFloat(process.env.ADMIN_SESSION_HOURS || '24')
) * 60 * 60 * 1000;

// Rate-limit admin login attempts: max 5 attempts per 2 minutes per IP.
const adminLoginAttempts = new Map(); // ip -> { count: number, resetAt: number }

// Rate-limit player code attempts: max 10 failed attempts per 2 minutes per IP.
const playerLoginAttempts = new Map(); // ip -> { count: number, resetAt: number }


// Debounced persist: batches high-frequency writes to at most one disk write per 500ms using non-blocking async I/O.
// Critical paths (login, game-start/end) still call persistState() directly.
let _persistTimer = null;
function schedulePersist() {
	if (_persistTimer) return;
	_persistTimer = setTimeout(async () => {
		_persistTimer = null;
		if (stateStore && typeof stateStore.writeAsync === 'function') {
			await stateStore.writeAsync(getPersistentSnapshot());
		} else {
			persistState();
		}
	}, 500);
}

const { emitTaskProgress, getGlobalProgress } = createGameProgress({
	io,
	getTaskProgress: () => taskProgress
});
const sendPushNotification = createPushNotifier({
	webPush,
	isEnabled: pushEnabled,
	getSubscriptions: () => pushSubscriptions,
	removeSubscription: (playerId, subscriptionId) => {
		const subscriptions = pushSubscriptions[playerId];
		if (!subscriptions) return;
		delete subscriptions[subscriptionId];
		if (Object.keys(subscriptions).length === 0) delete pushSubscriptions[playerId];
	},
	persistState: () => persistState()
});

loadPersistentState();

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
app.get('/api/player-auth-config', (_req, res) => {
	res.json({ required: playerJoinCodeRequired });
});
app.get('/api/admin/books.csv', (req, res) => {
	const authorization = req.get('authorization');
	if (!isValidAdminSessionToken(authorization)) {
		return res.status(401).json({ error: 'unauthorized' });
	}
	const rows = [['isbn', 'player', 'taskId', 'recordedAt']];
	for (const entries of Object.values(bookIsbns)) {
		for (const entry of entries) {
			rows.push([entry.isbn, entry.title || '', entry.authors || '', entry.playerName, entry.taskId, new Date(entry.recordedAt).toISOString()]);
		}
	}
	rows[0] = ['isbn', 'title', 'authors', 'player', 'taskId', 'recordedAt'];
	const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
	res.type('text/csv').set('Content-Disposition', 'attachment; filename="among-us-books.csv"').send(`${csv}\r\n`);
});
app.use('/api', createCollectionMapRouter({
	express,
	dataDir: DATA_DIR,
	isAdminSessionToken: authorization => isValidAdminSessionToken(authorization),
	hasCollection: collectionId => taskCollections.some(collection => collection.id === collectionId),
	getCollectionMap: collectionId => collectionMaps[collectionId],
	setCollectionMap: (collectionId, map) => { collectionMaps[collectionId] = map; },
	deleteCollectionMap: collectionId => { delete collectionMaps[collectionId]; },
	persistState,
	getCollectionMapUrl,
	removeCollectionMapFile,
	onChange: broadcastAdminState
}));
if (process.env.NODE_ENV === 'production') {
	const clientBuildPath = path.join(__dirname, '..', 'web', 'dist');
	app.use(express.static(clientBuildPath));
	app.get('/{*path}', (req, res) => {
		res.sendFile(path.join(clientBuildPath, 'index.html'));
	});
}

io.on('connection', socket => {
	console.log(
		`A user connected with role: ${socket.handshake.query.role}, total: ${
			io.of('/').sockets.size
		}`
	);

	// Associate socket with auth token (fallback to socket.id)
	const auth = socket.handshake.query.auth || socket.id;
	socketIdToAuth[socket.id] = auth;
	console.log('[connect] socket', socket.id, 'auth', auth);

	// Send current state to newly connected clients
	socket.emit('state', getStateSnapshot(false));

	// Allow clients to request a fresh snapshot of state
	socket.on('get-state', () => {
		socket.emit('state', getStateSnapshot(isAuthenticatedAdmin(socket)));
		if (isAuthenticatedAdmin(socket)) {
			socket.emit('global-progress', getGlobalProgress());
			socket.emit('gamemaster-update', getGamemasterSnapshot());
		}
		console.log('[get-state]', { socketId: socket.id, auth: socketIdToAuth[socket.id], isMeeting, isGameActive, emergencyCooldownEndMs });
	});

	socket.on('admin-login', (payload, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		if (typeof payload?.sessionToken === 'string') {
			if (!/^[A-Za-z0-9_-]{43}$/.test(payload.sessionToken)) {
				return reply({ ok: false, reason: 'invalid-session' });
			}
			const sessionHash = hashAdminSession(payload.sessionToken);
			const expiresAt = adminSessions[sessionHash];
			if (!expiresAt || expiresAt <= Date.now()) {
				if (expiresAt) {
					const previousExpiresAt = expiresAt;
					delete adminSessions[sessionHash];
					if (!persistState()) adminSessions[sessionHash] = previousExpiresAt;
				}
				return reply({ ok: false, reason: 'invalid-session' });
			}
			socket.data.isAdmin = true;
			socket.data.adminSessionHash = sessionHash;
			reply({ ok: true, sessionExpiresAt: expiresAt });
			socket.emit('state', getStateSnapshot(true));
			socket.emit('players-updated', getConnectedPlayers());
			socket.emit('global-progress', getGlobalProgress());
			socket.emit('gamemaster-update', getGamemasterSnapshot());
			return;
		}

		if (!adminCode) {
			return reply({ ok: false, reason: 'admin-not-configured' });
		}

		// Rate-limit code-based login attempts (5 per 2 minutes per IP).
		const loginIp = socket.handshake.address;
		const now = Date.now();
		const RATE_WINDOW_MS = 2 * 60 * 1000;
		const RATE_LIMIT = 5;
		let rateEntry = adminLoginAttempts.get(loginIp);
		if (!rateEntry || now > rateEntry.resetAt) {
			rateEntry = { count: 0, resetAt: now + RATE_WINDOW_MS };
		}
		rateEntry.count += 1;
		adminLoginAttempts.set(loginIp, rateEntry);
		if (rateEntry.count > RATE_LIMIT) {
			const retryAfterSec = Math.ceil((rateEntry.resetAt - now) / 1000);
			console.warn('[admin-login] rate-limited IP', loginIp, 'attempts:', rateEntry.count);
			return reply({ ok: false, reason: 'rate-limited', retryAfterSec });
		}

		const submittedCode = typeof payload?.code === 'string' ? Buffer.from(payload.code) : Buffer.alloc(0);
		const configuredCode = typeof adminCode === 'string' ? Buffer.from(adminCode) : Buffer.alloc(0);
		const valid = submittedCode.length === configuredCode.length &&
			crypto.timingSafeEqual(submittedCode, configuredCode);
		if (!valid) {
			return reply({ ok: false, reason: 'invalid-code' });
		}

		// Reset rate-limit on successful login.
		adminLoginAttempts.delete(loginIp);

		const sessionToken = crypto.randomBytes(32).toString('base64url');
		const sessionHash = hashAdminSession(sessionToken);
		adminSessions[sessionHash] = Date.now() + ADMIN_SESSION_DURATION_MS;
		if (!persistState()) {
			delete adminSessions[sessionHash];
			return reply({ ok: false, reason: 'persistence-unavailable' });
		}
		socket.data.isAdmin = true;
		socket.data.adminSessionHash = sessionHash;
		reply({
			ok: true,
			sessionToken,
			sessionExpiresAt: adminSessions[sessionHash]
		});
		socket.emit('state', getStateSnapshot(true));
		socket.emit('players-updated', getConnectedPlayers());
		socket.emit('global-progress', getGlobalProgress());
		socket.emit('gamemaster-update', getGamemasterSnapshot());
	});


	socket.on('admin-logout', acknowledge => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		if (socket.data.adminSessionHash) {
			const expiresAt = adminSessions[socket.data.adminSessionHash];
			delete adminSessions[socket.data.adminSessionHash];
			if (!persistState()) {
				if (expiresAt) adminSessions[socket.data.adminSessionHash] = expiresAt;
				return reply({ ok: false, reason: 'persistence-unavailable' });
			}
		}
		socket.data.isAdmin = false;
		delete socket.data.adminSessionHash;
		reply({ ok: true });
	});

	socket.on('player-login', (payload, acknowledge) => {
		const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
		const playerKey = name.toLowerCase();
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};

		if (socket.handshake.query.role !== 'PLAYER') {
			return reply({ ok: false, reason: 'invalid-role' });
		}
		if (playerJoinCodeRequired && !playerJoinCode) {
			return reply({ ok: false, reason: 'player-code-not-configured' });
		}
		if (playerJoinCodeRequired) {
			const clientIp = socket.handshake.address;
			const now = Date.now();
			const RATE_WINDOW_MS = 2 * 60 * 1000;
			const PLAYER_RATE_LIMIT = 10;
			let playerRateEntry = playerLoginAttempts.get(clientIp);
			if (!playerRateEntry || now > playerRateEntry.resetAt) {
				playerRateEntry = { count: 0, resetAt: now + RATE_WINDOW_MS };
			}
			if (playerRateEntry.count >= PLAYER_RATE_LIMIT) {
				const retryAfterSec = Math.ceil((playerRateEntry.resetAt - now) / 1000);
				return reply({ ok: false, reason: 'rate-limited', retryAfterSec });
			}

			const submittedCode = typeof payload?.code === 'string' ? Buffer.from(payload.code) : Buffer.alloc(0);
			const configuredCode = Buffer.from(playerJoinCode);
			const valid = submittedCode.length === configuredCode.length &&
				crypto.timingSafeEqual(submittedCode, configuredCode);
			if (!valid) {
				playerRateEntry.count += 1;
				playerLoginAttempts.set(clientIp, playerRateEntry);
				return reply({ ok: false, reason: 'invalid-player-code' });
			}
			playerLoginAttempts.delete(clientIp);
		}
		if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) {
			return reply({ ok: false, reason: 'invalid-name' });
		}
		const nameInUse = Array.from(io.of('/').sockets.values()).some(other =>
			other.id !== socket.id && other.data.playerId === playerKey
		);
		if (nameInUse) {
			return reply({ ok: false, reason: 'name-in-use' });
		}

		const token = typeof payload?.token === 'string' && payload.token.trim() ? payload.token.trim() : null;
		const existingPlayer = playerDirectory[playerKey];
		if (!existingPlayer) {
			const playerToken = token || crypto.randomUUID();
			playerDirectory[playerKey] = { id: playerKey, name, token: playerToken, lastSeenMs: Date.now() };
			if (!persistState()) {
				delete playerDirectory[playerKey];
				return reply({ ok: false, reason: 'persistence-unavailable' });
			}
		} else {
			// If an existing player has a session token, incoming request must supply it
			if (existingPlayer.token && (!token || token !== existingPlayer.token)) {
				return reply({ ok: false, reason: 'unauthorized-name' });
			}
			// Legacy support: if player had no token stored in previous state, initialize it
			if (!existingPlayer.token) {
				existingPlayer.token = token || crypto.randomUUID();
			}
			if (existingPlayer.name !== name) {
				const previousName = existingPlayer.name;
				existingPlayer.name = name;
				if (!persistState()) {
					existingPlayer.name = previousName;
					return reply({ ok: false, reason: 'persistence-unavailable' });
				}
			}
		}

		socket.data.playerId = playerKey;
		socket.data.playerToken = playerDirectory[playerKey].token;
		socketIdToAuth[socket.id] = playerKey;
		reply({
			ok: true,
			id: playerKey,
			name: playerDirectory[playerKey].name,
			token: playerDirectory[playerKey].token
		});
		socket.emit('state', getStateSnapshot(false));
		sendPlayerSnapshot(socket, playerKey);
		broadcastPlayersToAdmins();
		broadcastGamemasterUpdate();
		appendGameLog('player-login', `${name} joined the game`, { playerId: playerKey });
		console.log('[player-login]', { socketId: socket.id, playerId: playerKey });
	});

	socket.on('remove-player', (payload, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		const playerId = typeof payload?.playerId === 'string' ? payload.playerId : '';
		if (!isAuthenticatedAdmin(socket)) {
			return reply({ ok: false, reason: 'unauthorized' });
		}
		if (isGameActive) {
			return reply({ ok: false, reason: 'game-active' });
		}
		if (!playerId || !playerDirectory[playerId]) {
			return reply({ ok: false, reason: 'player-not-found' });
		}

		const previousState = {
			playerDirectory,
			authToPlayer,
			pushSubscriptions,
			killCooldownEndMsByAuth,
			impostorAuths,
			deadAuths
		};
		playerDirectory = Object.assign(Object.create(null), playerDirectory);
		authToPlayer = Object.assign(Object.create(null), authToPlayer);
		pushSubscriptions = Object.assign(Object.create(null), pushSubscriptions);
		killCooldownEndMsByAuth = Object.assign(Object.create(null), killCooldownEndMsByAuth);
		impostorAuths = new Set(impostorAuths);
		deadAuths = new Set(deadAuths);
		delete playerDirectory[playerId];
		delete authToPlayer[playerId];
		delete pushSubscriptions[playerId];
		delete killCooldownEndMsByAuth[playerId];
		impostorAuths.delete(playerId);
		deadAuths.delete(playerId);

		if (!persistState()) {
			playerDirectory = previousState.playerDirectory;
			authToPlayer = previousState.authToPlayer;
			pushSubscriptions = previousState.pushSubscriptions;
			killCooldownEndMsByAuth = previousState.killCooldownEndMsByAuth;
			impostorAuths = previousState.impostorAuths;
			deadAuths = previousState.deadAuths;
			return reply({ ok: false, reason: 'persistence-unavailable' });
		}

		for (const playerSocket of io.of('/').sockets.values()) {
			if (playerSocket.data.playerId === playerId) {
				playerSocket.emit('player-removed');
				playerSocket.disconnect(true);
			}
		}
		reply({ ok: true });
		broadcastPlayersToAdmins();
		broadcastGamemasterUpdate();
		console.log('[player-removed]', { playerId });
	});

	socket.on('save-task-collections', (payload, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		if (!isAuthenticatedAdmin(socket)) {
			return reply({ ok: false, reason: 'unauthorized' });
		}
		if (isGameActive) {
			return reply({ ok: false, reason: 'game-active' });
		}
		const collections = payload?.collections;
		if (!isValidTaskCollections(collections)) {
			return reply({ ok: false, reason: 'invalid-collections' });
		}
		const requestedSelection = typeof payload?.selectedTaskCollectionId === 'string'
			? payload.selectedTaskCollectionId
			: selectedTaskCollectionId;
		const selectedCollection = collections.find(collection => collection.id === requestedSelection);
		if (!selectedCollection) {
			return reply({ ok: false, reason: 'invalid-collections' });
		}

		const previousCollections = taskCollections;
		const previousSelectedCollectionId = selectedTaskCollectionId;
		const previousConfiguredTasks = gameConfig.tasks;
		const previousCollectionMaps = collectionMaps;
		taskCollections = collections.map(collection => ({
			id: collection.id,
			name: collection.name.trim(),
			tasks: collection.tasks.map(normalizeTask)
		}));
		const retainedIds = new Set(taskCollections.map(collection => collection.id));
		collectionMaps = Object.assign(Object.create(null), collectionMaps);
		for (const collectionId of Object.keys(collectionMaps)) {
			if (!retainedIds.has(collectionId)) delete collectionMaps[collectionId];
		}
		selectedTaskCollectionId = selectedCollection.id;
		gameConfig.tasks = selectedCollection.tasks.map(normalizeTask);
		if (!persistState()) {
			taskCollections = previousCollections;
			selectedTaskCollectionId = previousSelectedCollectionId;
			gameConfig.tasks = previousConfiguredTasks;
			collectionMaps = previousCollectionMaps;
			return reply({ ok: false, reason: 'persistence-unavailable' });
		}
		for (const [collectionId, map] of Object.entries(previousCollectionMaps)) {
			if (!collectionMaps[collectionId]) removeCollectionMapFile(map);
		}
		reply({
			ok: true,
			collections: getTaskCollectionsSnapshot(),
			selectedTaskCollectionId
		});
		broadcastAdminState();
	});

	socket.on('get-push-config', acknowledge => {
		if (typeof acknowledge === 'function') {
			acknowledge({ enabled: pushEnabled, publicKey: pushEnabled ? vapidPublicKey : null });
		}
	});

	socket.on('save-push-subscription', (payload, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		const playerId = socket.data.playerId;
		const subscription = payload?.subscription;
		if (!playerId || !pushEnabled) {
			return reply({ ok: false, reason: 'push-unavailable' });
		}
		if (!isValidPushSubscription(subscription)) {
			return reply({ ok: false, reason: 'invalid-subscription' });
		}

		const subscriptionId = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
		const previousSubscriptions = pushSubscriptions;
		pushSubscriptions = Object.assign(Object.create(null), pushSubscriptions);
		for (const [registeredPlayerId, subscriptions] of Object.entries(pushSubscriptions)) {
			const nextSubscriptions = Object.assign(Object.create(null), subscriptions);
			for (const [id, existingSubscription] of Object.entries(nextSubscriptions)) {
				if (existingSubscription.endpoint === subscription.endpoint) {
					delete nextSubscriptions[id];
				}
			}
			if (Object.keys(nextSubscriptions).length) pushSubscriptions[registeredPlayerId] = nextSubscriptions;
			else delete pushSubscriptions[registeredPlayerId];
		}
		pushSubscriptions[playerId] = {
			...(pushSubscriptions[playerId] || {}),
			[subscriptionId]: subscription
		};
		if (!persistState()) {
			pushSubscriptions = previousSubscriptions;
			return reply({ ok: false, reason: 'persistence-unavailable' });
		}
		reply({ ok: true });
	});

	socket.on('remove-push-subscription', (payload, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		const playerId = socket.data.playerId;
		const endpoint = payload?.endpoint;
		if (!playerId || typeof endpoint !== 'string') {
			return reply({ ok: false, reason: 'invalid-subscription' });
		}
		const subscriptions = pushSubscriptions[playerId];
		if (subscriptions) {
			const previous = { ...subscriptions };
			for (const [id, subscription] of Object.entries(subscriptions)) {
				if (subscription.endpoint === endpoint) delete subscriptions[id];
			}
			if (Object.keys(subscriptions).length === 0) delete pushSubscriptions[playerId];
			if (!persistState()) {
				pushSubscriptions[playerId] = previous;
				return reply({ ok: false, reason: 'persistence-unavailable' });
			}
		}
		reply({ ok: true });
	});

	// Rehydration: client asks who am I with its auth
	socket.on('whoami', (payload) => {
		const playerId = socket.data.playerId;
		if (playerId) sendPlayerSnapshot(socket, playerId);
	});

	socket.on('start-game', payload => {
		if (!isAuthenticatedAdmin(socket)) {
			return socket.emit('start-error', { reason: 'unauthorized' });
		}
		if (isGameActive) {
			return socket.emit('start-error', { reason: 'game-already-active' });
		}
		const requestedCollectionId = typeof payload?.taskCollectionId === 'string'
			? payload.taskCollectionId
			: selectedTaskCollectionId;
		const selectedCollection = taskCollections.find(collection => collection.id === requestedCollectionId);
		if (!selectedCollection) {
			return socket.emit('start-error', { reason: 'invalid-task-collection' });
		}
		if (selectedCollection.tasks.length === 0) {
			return socket.emit('start-error', { reason: 'empty-task-collection' });
		}
		// Update runtime config from admin payload if provided
		if (payload && typeof payload === 'object') {
			if (selectedCollection) {
				selectedTaskCollectionId = selectedCollection.id;
				gameConfig.tasks = selectedCollection.tasks.slice();
			} else if (Array.isArray(payload.tasks) && payload.tasks.length > 0) {
				gameConfig.tasks = payload.tasks;
			}
			if (typeof payload.numImpostors === 'number' && payload.numImpostors >= 0) {
				gameConfig.numImpostors = payload.numImpostors;
			}
			if (typeof payload.numTasksPerPlayer === 'number' && payload.numTasksPerPlayer > 0) {
				const taskPoolSize = Array.isArray(payload.tasks) && payload.tasks.length > 0
					? payload.tasks.length
					: gameConfig.tasks.length;
				gameConfig.numTasksPerPlayer = Math.min(Math.floor(payload.numTasksPerPlayer), Math.max(1, taskPoolSize));
			}
			if (typeof payload.emergencyCooldownMinutes === 'number' && payload.emergencyCooldownMinutes >= 0) {
				gameConfig.emergencyCooldownMinutes = payload.emergencyCooldownMinutes;
			}
			if (typeof payload.killCooldownSeconds === 'number' && payload.killCooldownSeconds >= 0) {
				gameConfig.killCooldownSeconds = payload.killCooldownSeconds;
			}
			if (typeof payload.maxPlayersPerTask === 'number' && payload.maxPlayersPerTask > 0) {
				gameConfig.maxPlayersPerTask = payload.maxPlayersPerTask;
			}
			if (typeof payload.sabotageDurationSeconds === 'number' && payload.sabotageDurationSeconds >= 0) {
				gameConfig.sabotageDurationSeconds = payload.sabotageDurationSeconds;
			}
			if (typeof payload.sabotageCharges === 'number' && payload.sabotageCharges >= 0) {
				gameConfig.sabotageCharges = payload.sabotageCharges;
			}
			if (payload.sabotageMode === 'button' || payload.sabotageMode === 'qr') {
				gameConfig.sabotageMode = payload.sabotageMode;
			}
			if (Array.isArray(payload.sabotageQrCodes) &&
				payload.sabotageQrCodes.length <= 20 &&
				payload.sabotageQrCodes.every(code => typeof code === 'string' && code.trim().length <= 300)) {
				gameConfig.sabotageQrCodes = payload.sabotageQrCodes.map(code => code.trim()).filter(Boolean);
			}
			if (typeof payload.deadTaskCompletionIntervalSeconds === 'number' &&
				payload.deadTaskCompletionIntervalSeconds > 0) {
				gameConfig.deadTaskCompletionIntervalSeconds = payload.deadTaskCompletionIntervalSeconds;
			}
			if (gameConfig.sabotageMode === 'qr' && gameConfig.sabotageQrCodes.length < 2) {
				return socket.emit('start-error', { reason: 'invalid-sabotage-qr-config' });
			}
		}
		selectedTaskCollectionId = selectedCollection?.id || requestedCollectionId;
		console.log('[start-game] config', gameConfig);
		// Get player sockets
		const players = [];
		for (const [_, socket] of io.of('/').sockets) {
			if (socket.handshake.query.role === 'PLAYER' && socket.data.playerId) {
				players.push(socket);
			}
		}
		const playerIds = players.map(player => player.id);
		console.log('[start-game] player sockets', players.length);

		// Guard: need at least 1 player
		if (playerIds.length === 0) {
			return socket.emit('start-error', { reason: 'no-players' });
		}

		// Assign impostors (ensure at least 1, at most number of players)
		const impostorCount = Math.max(1, Math.min(gameConfig.numImpostors || 1, playerIds.length));
		const impostors = _.shuffle(playerIds).slice(0, impostorCount);
		impostorIds = new Set(impostors);
		// Build auth mapping for players and reset persisted maps
		const authBySocketId = Object.create(null);
		for (const p of players) {
			authBySocketId[p.id] = p.data.playerId || p.handshake.query.auth || p.id;
		}
		impostorAuths = new Set(impostors.map(id => authBySocketId[id]));
		const uniqueAuths = Array.from(new Set(Object.values(authBySocketId)));
		console.log('[start-game] impostors (socketIds)', Array.from(impostorIds));
		console.log('[start-game] impostors (auths)', Array.from(impostorAuths));
		console.log('[start-game] unique players (auths)', uniqueAuths);
		authToPlayer = Object.create(null);
		taskActionProgressByAuth = Object.create(null);
		bookIsbns = Object.create(null);
		killCooldownEndMsByAuth = Object.create(null);
		killCooldownEndMsBySocketId = {};
        //Reset dead players
        deadAuths = new Set();
		deadTaskNextCompletionAtByAuth = Object.create(null);
		clearDeadTaskCompletionTimers();
		// Reset sabotage state
		isSabotageActive = false;
		sabotageEndMs = 0;
		sabotageUsedAuths = new Set();
		sabotageDefuserAuths = new Set();
		sabotageChargesRemaining = Math.max(0, Number(gameConfig.sabotageCharges || 0));
		if (sabotageTimeout) {
			clearTimeout(sabotageTimeout);
			sabotageTimeout = null;
		}
		const initialKillCooldownMs = Math.max(0, (gameConfig.killCooldownSeconds || 0) * 1000);
		const startNow = Date.now();
		// Phase 1: assign all impostors first
		for (const id of impostors) {
			const socket = io.of('/').sockets.get(id);
			if (!socket || socket.handshake.query.role !== 'PLAYER') continue;
			socket.emit('role', 'Impostor');
			const a = authBySocketId[id] || id;
			killCooldownEndMsByAuth[a] = startNow + initialKillCooldownMs;
			killCooldownEndMsBySocketId[id] = killCooldownEndMsByAuth[a];
			socket.emit('kill-cooldown-updated', { endMs: killCooldownEndMsBySocketId[id] });
			console.log('[start-game] role-assigned', { socketId: id, auth: a, role: 'Impostor', killCooldownEndMs: killCooldownEndMsBySocketId[id] });
		}
		// Phase 2: assign the remaining players as crewmates
		for (const id of playerIds) {
			if (impostors.includes(id)) continue;
			const socket = io.of('/').sockets.get(id);
			if (!socket || socket.handshake.query.role !== 'PLAYER') continue;
			socket.emit('role', 'Crewmate');
			console.log('[start-game] role-assigned', { socketId: id, auth: authBySocketId[id] || id, role: 'Crewmate' });
		}

		// Assign tasks with per-player uniqueness and global per-task cap
		const tasksPool = Array.isArray(gameConfig.tasks) ? gameConfig.tasks.map(normalizeTask) : [];
		const maxPerTask = Math.max(1, Number(gameConfig.maxPlayersPerTask || 2));
		const desiredTaskCount = Math.max(1, Number(gameConfig.numTasksPerPlayer || DEFAULT_TASKS_PER_PLAYER));
		const tasksPerPlayer = Math.min(desiredTaskCount, Math.max(1, tasksPool.length || 1));
		const assignedCountByTask = Object.create(null);
		for (const t of tasksPool) assignedCountByTask[taskKey(t)] = 0;

		// Track each player's assigned labels to enforce uniqueness
		const playerTaskLabels = Object.create(null);
		const playerTasks = Object.create(null);
		taskProgress = {};
		taskActivityByAuth = Object.create(null);
		impostorCompletedTasksByAuth = Object.create(null);
		meetingCaller = null;
		meetingVotes = Object.create(null);
		meetingResults = null;
		gameLog = [];
		appendGameLog('game-started', 'Game started', { players: uniqueAuths.length, impostors: impostorAuths.size });
		for (const a of uniqueAuths) {
			playerTaskLabels[a] = new Set();
			playerTasks[a] = {};
		}

		for (let i = 0; i < tasksPerPlayer; i++) {
			for (const a of uniqueAuths) {
				const labelSet = playerTaskLabels[a];
				const eligible = tasksPool.filter(task => {
					return !labelSet.has(taskKey(task)) && (assignedCountByTask[taskKey(task)] || 0) < maxPerTask;
				});
				let candidates = eligible;
				if (candidates.length === 0) {
					candidates = tasksPool.filter(task => !labelSet.has(taskKey(task)));
				}
				if (candidates.length === 0) {
					continue;
				}
				const minCount = Math.min(...candidates.map(task => assignedCountByTask[taskKey(task)] || 0));
				const task = _.shuffle(candidates.filter(candidate => (assignedCountByTask[taskKey(candidate)] || 0) === minCount))[0];
				if (!task) continue;

				labelSet.add(taskKey(task));
				assignedCountByTask[taskKey(task)] = (assignedCountByTask[taskKey(task)] || 0) + 1;

				const taskId = crypto.randomUUID();
				playerTasks[a][taskId] = task;
				console.log('[assign-task]', { auth: a, taskId, task: taskDisplayLabel(task) });
				if (!impostorAuths.has(a)) {
					taskProgress[taskId] = false;
				}
			}
		}
		console.log('[assignment-summary] per-task counts', assignedCountByTask);

		console.log('player tasks', playerTasks);

		// Save assignments before sending completion snapshots to players.
		for (const a of uniqueAuths) {
			const role = impostorAuths.has(a) ? 'Impostor' : 'Crewmate';
			authToPlayer[a] = {
				...authToPlayer[a],
				role,
				tasks: playerTasks[a] || {}
			};
		}

		for (const [id, socket] of io.of('/').sockets) {
			if (playerIds.includes(id)) {
				const a = authBySocketId[id] || id;
				socket.emit('tasks', playerTasks[a]);
				console.log('[emit-tasks]', { socketId: id, auth: a, count: Object.keys(playerTasks[a] || {}).length });
				// Also send completion snapshot and current progress for this auth
				socket.emit('tasks-completed', getCompletionMapForAuth(a));
				const vals = Object.values(taskProgress);
				const ratio = vals.length ? vals.filter(Boolean).length / vals.length : 0;
				socket.emit('progress', ratio);
			}
		}

		// Broadcast initial sabotage charges to all clients
		io.emit('sabotage-charges', { remaining: sabotageChargesRemaining });

		emitTaskProgress();

		// Start game state
		gameWinner = null;
		isMeeting = false;
		isGameActive = true;
		emergencyCooldownEndMs = 0;
		lastMeetingType = null;
		io.emit('game-started');
		io.emit('state', getStateSnapshot(false));
		broadcastGamemasterUpdate();
		io.emit('cooldown-updated', { emergencyCooldownEndMs });
		persistState();
		console.log('[game-started]');
	});

	socket.on('report', () => {
		if (!socket.data.playerId || !isGameActive || isMeeting) return;
		const callerAuth = socketIdToAuth[socket.id];
		if (!callerAuth || deadAuths.has(callerAuth)) return;
		// Cancel sabotage if active upon finding a dead body (Among Us rule)
		if (isSabotageActive) {
			isSabotageActive = false;
			sabotageEndMs = 0;
			if (sabotageTimeout) {
				clearTimeout(sabotageTimeout);
				sabotageTimeout = null;
			}
			io.emit('sabotage-ended', { reason: 'meeting' });
			appendGameLog('sabotage-cleared', 'Sabotage cleared by reported body');
		}
		isMeeting = true;
		lastMeetingType = 'report';
		const callerName = playerDirectory[callerAuth]?.name || callerAuth;
		meetingCaller = { id: callerAuth, name: callerName, type: 'report' };
		meetingVotes = Object.create(null);
		meetingResults = null;
		io.emit('play-meeting');
		io.emit('meeting-started', { caller: meetingCaller });
		void sendPushNotification('Dead body reported', `${callerName} reported a body. Return for the meeting.`, 'among-us-meeting');
		persistState();
		console.log('[report]', { socketId: socket.id, auth: callerAuth });
		appendGameLog('meeting', `Dead body reported by ${callerName}`, { callerId: callerAuth });
		broadcastGamemasterUpdate();
	});

	socket.on('emergency-meeting', () => {
		if ((!socket.data.playerId && !isAuthenticatedAdmin(socket)) || !isGameActive || isMeeting) return;
		const callerAuth = socketIdToAuth[socket.id];
		if (socket.data.playerId && deadAuths.has(callerAuth)) return;
		if (Date.now() < emergencyCooldownEndMs) return;
		if (isSabotageActive) return; // Emergency meetings blocked while sabotage is active
		isMeeting = true;
		lastMeetingType = 'emergency';
		const callerName = socket.data.playerId ? (playerDirectory[callerAuth]?.name || callerAuth) : 'Admin';
		meetingCaller = { id: callerAuth || 'admin', name: callerName, type: 'emergency' };
		meetingVotes = Object.create(null);
		meetingResults = null;
		io.emit('play-meeting');
		io.emit('meeting-started', { caller: meetingCaller });
		void sendPushNotification('Emergency meeting', `${callerName} called an emergency meeting.`, 'among-us-meeting');
		persistState();
		console.log('[emergency-meeting]', { socketId: socket.id, auth: callerAuth });
		appendGameLog('meeting', `Emergency meeting called by ${callerName}`, { callerId: callerAuth });
		broadcastGamemasterUpdate();
	});

	socket.on('cast-vote', payload => {
		if (!socket.data.playerId || !isGameActive || !isMeeting || meetingResults) return;
		const voterAuth = socketIdToAuth[socket.id];
		if (!voterAuth || deadAuths.has(voterAuth)) return;
		if (meetingVotes[voterAuth]) return;

		const target = typeof payload?.target === 'string' ? payload.target.trim() : '';
		const livingPlayers = Object.keys(authToPlayer).filter(id => !deadAuths.has(id));
		if (target !== 'skip' && !livingPlayers.includes(target)) return;

		meetingVotes[voterAuth] = target;
		io.emit('vote-cast', { voterId: voterAuth, totalVotes: Object.keys(meetingVotes).length });
		schedulePersist();
		console.log('[cast-vote]', { voter: voterAuth, target });

		const allLiving = Object.keys(authToPlayer).filter(id => !deadAuths.has(id));
		if (allLiving.length > 0 && allLiving.every(id => meetingVotes[id])) {
			concludeVoting();
		}
	});

	socket.on('admin-end-voting', () => {
		if (!isAuthenticatedAdmin(socket) || !isGameActive || !isMeeting || meetingResults) return;
		concludeVoting();
	});

	socket.on('admin-eject-player', (payload, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		if (!isAuthenticatedAdmin(socket) || !isGameActive) return reply({ ok: false, reason: 'unauthorized' });
		const playerId = typeof payload?.playerId === 'string' ? payload.playerId : '';
		if (!playerId || !authToPlayer[playerId] || deadAuths.has(playerId)) {
			return reply({ ok: false, reason: 'invalid-player' });
		}
		deadAuths.add(playerId);
		if (!impostorAuths.has(playerId)) {
			deadTaskNextCompletionAtByAuth[playerId] = Date.now() +
				Math.max(1, Number(gameConfig.deadTaskCompletionIntervalSeconds || 90)) * 1000;
			scheduleDeadTaskCompletion(playerId);
		}
		for (const s of io.of('/').sockets.values()) {
			if (s.data.playerId === playerId) {
				s.emit('player-dead');
			}
		}
		appendGameLog('player-ejected', `${playerDirectory[playerId]?.name || playerId} was eliminated by admin.`, { playerId });
		broadcastPlayersToAdmins();
		broadcastGamemasterUpdate();
		persistState();
		if (hasCrewmateVictory({ impostorAuths, deadAuths })) {
			finishGame('crewmates');
		} else if (hasImpostorVictory({ players: authToPlayer, impostorAuths, deadAuths })) {
			finishGame('impostors');
		}
		reply({ ok: true });
	});

	socket.on('continue-game', () => {
		if (!isAuthenticatedAdmin(socket) || !isGameActive) return;
		isMeeting = false;
		meetingCaller = null;
		meetingVotes = Object.create(null);
		meetingResults = null;
		// Reset kill cooldown for all impostors at the end of a meeting
		const killMs = Math.max(0, (gameConfig.killCooldownSeconds || 0) * 1000);
		const now = Date.now();
		for (const id of impostorIds) {
			killCooldownEndMsBySocketId[id] = now + killMs;
			const sock = io.of('/').sockets.get(id);
			if (sock) {
				sock.emit('kill-cooldown-updated', { endMs: killCooldownEndMsBySocketId[id] });
			}
			const a = socketIdToAuth[id];
			if (a) killCooldownEndMsByAuth[a] = now + killMs;
			console.log('[cooldown-reset-after-meeting]', { socketId: id, auth: a, endMs: killCooldownEndMsBySocketId[id] });
		}
		if (lastMeetingType === 'emergency' && gameConfig.emergencyCooldownMinutes > 0) {
			emergencyCooldownEndMs = Date.now() + gameConfig.emergencyCooldownMinutes * 60 * 1000;
		}
		io.emit('meeting-ended');
		io.emit('cooldown-updated', { emergencyCooldownEndMs });
		persistState();
		console.log('[meeting-ended]', { emergencyCooldownEndMs });
		appendGameLog('meeting-ended', 'Meeting ended');
		broadcastGamemasterUpdate();
	});

	socket.on('end-game', () => {
		if (!isAuthenticatedAdmin(socket) || (!isGameActive && !gameWinner)) return;
		isMeeting = false;
		isGameActive = false;
		emergencyCooldownEndMs = 0;
		impostorIds = new Set();
		impostorAuths = new Set();
		killCooldownEndMsBySocketId = {};
		killCooldownEndMsByAuth = Object.create(null);
        // Reset dead players
        deadAuths = new Set();
		deadTaskNextCompletionAtByAuth = Object.create(null);
		clearDeadTaskCompletionTimers();
		// Clear sabotage
		isSabotageActive = false;
		sabotageEndMs = 0;
		sabotageUsedAuths = new Set();
		sabotageDefuserAuths = new Set();
		if (sabotageTimeout) {
			clearTimeout(sabotageTimeout);
			sabotageTimeout = null;
		}
		sabotageChargesRemaining = 0;
		for (const key of Object.keys(authToPlayer)) {
			if (authToPlayer[key]) {
				authToPlayer[key].tasks = {};
				authToPlayer[key].role = '';
			}
		}
		taskProgress = Object.create(null);
		meetingCaller = null;
		meetingVotes = Object.create(null);
		meetingResults = null;
		impostorCompletedTasksByAuth = Object.create(null);
		gameWinner = null;
		emitTaskProgress();
		io.emit('game-ended');
		io.emit('state', getStateSnapshot(false));
		io.emit('cooldown-updated', { emergencyCooldownEndMs });
		persistState();
		broadcastPlayersToAdmins();
		broadcastGamemasterUpdate();
		console.log('[game-ended]');
	});

	// Impostor kill attempt
	socket.on('kill', () => {
		if (!socket.data.playerId || !isGameActive || isMeeting) return;
		if (!impostorIds.has(socket.id)) return;
		if (deadAuths.has(socketIdToAuth[socket.id])) return;
		const now = Date.now();
		const endMs = killCooldownEndMsBySocketId[socket.id] || 0;
		if (now < endMs) return; // still cooling down
		const cooldownMs = Math.max(0, (gameConfig.killCooldownSeconds || 0) * 1000);
		killCooldownEndMsBySocketId[socket.id] = now + cooldownMs;
		const a = socketIdToAuth[socket.id];
		if (a) killCooldownEndMsByAuth[a] = killCooldownEndMsBySocketId[socket.id];
		socket.emit('kill-cooldown-updated', { endMs: killCooldownEndMsBySocketId[socket.id] });
		schedulePersist();
		console.log('[kill]', { socketId: socket.id, auth: a, endMs: killCooldownEndMsBySocketId[socket.id] });
		appendGameLog('kill', 'Impostor action registered', { playerId: a });
	});

	// Impostor sabotage attempt (one-time per impostor)
	socket.on('sabotage', () => {
		if (!socket.data.playerId || !isGameActive || isMeeting) return;
		if (!impostorIds.has(socket.id)) return;
		const a = socketIdToAuth[socket.id];
		if (!a) return;
		if (sabotageUsedAuths.has(a)) return;
		if (isSabotageActive && sabotageEndMs > Date.now()) return;
		if (sabotageChargesRemaining <= 0) return;
		const durationMs = Math.max(0, (gameConfig.sabotageDurationSeconds || 0) * 1000);
		if (durationMs <= 0) return;
		const endMs = Date.now() + durationMs;
		isSabotageActive = true;
		sabotageEndMs = endMs;
		sabotageDefuserAuths = new Set();
		sabotageUsedAuths.add(a);
		sabotageChargesRemaining = Math.max(0, sabotageChargesRemaining - 1);
		io.emit('sabotage-started', { endMs });
		io.emit('sabotage-charges', { remaining: sabotageChargesRemaining });
		void sendPushNotification(
			'Sabotage activated',
			'Two players must press Defuse sabotage before the timer expires.',
			'among-us-sabotage'
		);
		// Also inform this impostor they've used their sabotage
		socket.emit('sabotage-usage', { used: true });
		schedulePersist();
		appendGameLog('sabotage', 'Sabotage activated', { playerId: a });
		if (sabotageTimeout) clearTimeout(sabotageTimeout);
		sabotageTimeout = setTimeout(() => {
			sabotageTimeout = null;
			if (!isSabotageActive) return;
			isSabotageActive = false;
			sabotageEndMs = 0;
			io.emit('sabotage-ended', { reason: 'timeout' });
			persistState();
			finishGame('impostors');
		}, durationMs);
	});

	socket.on('defuse-sabotage', code => {
		if (!socket.data.playerId || !isGameActive || !isSabotageActive) return;
		const auth = socketIdToAuth[socket.id];
		if (!auth || deadAuths.has(auth)) return;
		if (gameConfig.sabotageMode === 'qr') {
			const normalizedCode = typeof code === 'string' ? code.trim() : '';
			if (!normalizedCode || !gameConfig.sabotageQrCodes.includes(normalizedCode)) return;
			if (sabotageDefuserAuths.has(`${auth}:${normalizedCode}`)) return;
			sabotageDefuserAuths.add(`${auth}:${normalizedCode}`);
			const scannedCodes = new Set(Array.from(sabotageDefuserAuths)
				.filter(value => value.startsWith(`${auth}:`))
				.map(value => value.slice(auth.length + 1)));
			if (scannedCodes.size < 1) return;
			// QR mode requires two different codes, scanned by any living players.
			const distinctCodes = new Set(Array.from(sabotageDefuserAuths)
				.map(value => value.includes(':') ? value.slice(value.indexOf(':') + 1) : value));
			io.emit('sabotage-progress', { completed: distinctCodes.size, required: 2 });
			if (distinctCodes.size < 2) {
				schedulePersist();
				return;
			}
		} else {
			if (sabotageDefuserAuths.has(auth)) return;
			sabotageDefuserAuths.add(auth);
			io.emit('sabotage-progress', { completed: sabotageDefuserAuths.size, required: 2 });
			if (sabotageDefuserAuths.size < 2) return;
		}
		persistState();

		isSabotageActive = false;
		sabotageEndMs = 0;
		if (sabotageTimeout) clearTimeout(sabotageTimeout);
		sabotageTimeout = null;
		io.emit('sabotage-ended', { reason: 'defused' });
		const defuserPlayerIds = Array.from(new Set(Array.from(sabotageDefuserAuths)
			.map(entry => entry.includes(':') ? entry.split(':')[0] : entry)));
		const defuserNames = defuserPlayerIds.map(entry => playerDirectory[entry]?.name || entry);
		void sendPushNotification(
			'Sabotage defused',
			'The sabotage was successfully defused.',
			'among-us-sabotage-defused'
		);
		persistState();
		console.log('[sabotage-defused]', { auths: defuserPlayerIds });
		appendGameLog(
			'sabotage-defused',
			`Sabotage defused by ${defuserNames.join(' and ')}`,
			{ playerIds: defuserPlayerIds, playerNames: defuserNames }
		);
	});

	socket.on('task-complete', taskId => {
		if (!socket.data.playerId || isMeeting || !isGameActive) return;
		const auth = socketIdToAuth[socket.id];
		const task = authToPlayer[auth]?.tasks?.[taskId];
		if (!auth || deadAuths.has(auth) || impostorAuths.has(auth) || !task || task.type !== 'manual') return;
		const isNewlyCompleted = taskProgress[taskId] === false;
		if (typeof taskProgress[taskId] === 'boolean') {
			taskProgress[taskId] = true;
		}
		recordTaskActivity(auth, taskId, true);
		emitTaskProgress();
		console.log('[task-complete]', { socketId: socket.id, auth, taskId });
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
		const progress = getGlobalProgress();
		if (isNewlyCompleted && progress.total > 0 && progress.completed === progress.total) {
			finishGame('crewmates');
		}
		schedulePersist();
		broadcastGamemasterUpdate();
	});

	socket.on('task-action', (taskId, value, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		if (!socket.data.playerId || isMeeting || !isGameActive) return reply({ ok: false, reason: 'unavailable' });
		const auth = socketIdToAuth[socket.id];
		const task = authToPlayer[auth]?.tasks?.[taskId];
		if (!auth || deadAuths.has(auth) || impostorAuths.has(auth) || !task || !['qr', 'isbn'].includes(task.type)) {
			return reply({ ok: false, reason: 'invalid-task' });
		}
		const input = typeof value === 'string' ? value.trim() : '';
		if (!input) return reply({ ok: false, reason: 'empty-value' });
		if (!taskActionProgressByAuth[auth]) taskActionProgressByAuth[auth] = Object.create(null);
		const progress = taskActionProgressByAuth[auth][taskId] || { values: [], approved: [] };
		if (!Array.isArray(progress.values)) progress.values = [];
		if (!Array.isArray(progress.approved)) progress.approved = [];
		if (task.type === 'qr') {
			if (!Array.isArray(task.qrCodes) || !task.qrCodes.includes(input)) {
				return reply({ ok: false, reason: 'invalid-qr' });
			}
			if (progress.values.includes(input)) return reply({ ok: false, reason: 'duplicate' });
			progress.values.push(input);
		} else {
			const isbn = normalizeIsbn(input);
			if (!isValidIsbn(isbn)) return reply({ ok: false, reason: 'invalid-isbn' });
			if (progress.values.includes(isbn)) return reply({ ok: false, reason: 'duplicate' });
			progress.values.push(isbn);
			if (!bookIsbns[taskId]) bookIsbns[taskId] = [];
			bookIsbns[taskId].push({
				isbn,
				title: '',
				authors: '',
				playerId: auth,
				approved: false,
				playerName: playerDirectory[auth]?.name || auth,
				taskId,
				recordedAt: Date.now()
			});
		}
		taskActionProgressByAuth[auth][taskId] = progress;
		const required = task.type === 'isbn' ? Math.max(1, Number(task.isbnCount || 1)) : Math.max(1, task.qrCodes.length);
		const completedCount = task.type === 'isbn' ? progress.approved.length : progress.values.length;
		const isNewlyCompleted = taskProgress[taskId] === false && completedCount >= required;
		if (completedCount >= required) {
			taskProgress[taskId] = true;
			recordTaskActivity(auth, taskId, true);
		}
		socket.emit('task-action-progress', {
			taskId,
			completed: completedCount,
			submitted: progress.values.length,
			required
		});
		if (task.type === 'isbn') {
			const entry = bookIsbns[taskId][bookIsbns[taskId].length - 1];
			const submittedIsbn = progress.values[progress.values.length - 1];
			socket.emit('book-submitted', {
				taskId,
				isbn: submittedIsbn,
				title: entry.title,
				authors: entry.authors,
				approved: false
			});
			void lookupBookMetadata(submittedIsbn).then(metadata => {
				if (!metadata) return;
				entry.title = metadata.title;
				entry.authors = metadata.authors;
				persistState();
				socket.emit('book-metadata', { taskId, isbn: submittedIsbn, ...metadata });
			}).catch(error => {
				console.warn('[books] Metadata lookup failed:', error.message);
			});
		}
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
		reply({
			ok: true,
			completed: completedCount,
			submitted: progress.values.length,
			required,
			isbn: task.type === 'isbn' ? progress.values[progress.values.length - 1] : undefined
		});
		emitTaskProgress();
		if (isNewlyCompleted && getGlobalProgress().total > 0 && getGlobalProgress().completed === getGlobalProgress().total) {
			finishGame('crewmates');
		}
		schedulePersist();
		broadcastGamemasterUpdate();
	});

	socket.on('task-action-approve', (taskId, value, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		const auth = socketIdToAuth[socket.id];
		const task = authToPlayer[auth]?.tasks?.[taskId];
		const isbn = typeof value === 'string' ? normalizeIsbn(value) : '';
		const progress = taskActionProgressByAuth[auth]?.[taskId];
		if (!auth || deadAuths.has(auth) || impostorAuths.has(auth) || task?.type !== 'isbn' ||
			!progress?.values?.includes(isbn)) {
			return reply({ ok: false, reason: 'not-found' });
		}
		if (!Array.isArray(progress.approved)) progress.approved = [];
		if (progress.approved.includes(isbn)) return reply({ ok: false, reason: 'duplicate' });
		progress.approved.push(isbn);
		const entry = (bookIsbns[taskId] || []).find(item =>
			item.isbn === isbn && (item.playerId === auth || item.playerName === (playerDirectory[auth]?.name || auth))
		);
		if (entry) entry.approved = true;
		const required = Math.max(1, Number(task.isbnCount || 1));
		const completed = progress.approved.length;
		if (completed >= required && taskProgress[taskId] === false) {
			taskProgress[taskId] = true;
			recordTaskActivity(auth, taskId, true);
		}
		socket.emit('book-approved', { taskId, isbn });
		socket.emit('task-action-progress', {
			taskId,
			completed,
			submitted: progress.values.length,
			required
		});
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
		reply({ ok: true, completed, required });
		emitTaskProgress();
		if (completed >= required && getGlobalProgress().total > 0 &&
			getGlobalProgress().completed === getGlobalProgress().total) {
			finishGame('crewmates');
		}
		schedulePersist();
		broadcastGamemasterUpdate();
	});

	socket.on('task-action-remove', (taskId, value, acknowledge) => {
		const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
		const auth = socketIdToAuth[socket.id];
		const task = authToPlayer[auth]?.tasks?.[taskId];
		const isbn = typeof value === 'string' ? normalizeIsbn(value) : '';
		const progress = taskActionProgressByAuth[auth]?.[taskId];
		if (!auth || deadAuths.has(auth) || impostorAuths.has(auth) || task?.type !== 'isbn' ||
			!progress?.values?.includes(isbn)) {
			return reply({ ok: false, reason: 'not-found' });
		}
		progress.values = progress.values.filter(item => item !== isbn);
		progress.approved = Array.isArray(progress.approved)
			? progress.approved.filter(item => item !== isbn)
			: [];
		bookIsbns[taskId] = (bookIsbns[taskId] || []).filter(entry =>
			!(entry.isbn === isbn && (entry.playerId === auth || entry.playerName === (playerDirectory[auth]?.name || auth)))
		);
		if (progress.approved.length < Number(task.isbnCount || 1)) taskProgress[taskId] = false;
		socket.emit('task-action-progress', {
			taskId,
			completed: progress.approved.length,
			submitted: progress.values.length,
			required: Math.max(1, Number(task.isbnCount || 1))
		});
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
		reply({ ok: true });
		emitTaskProgress();
		schedulePersist();
		broadcastGamemasterUpdate();
	});

	socket.on('task-incomplete', taskId => {
		if (!socket.data.playerId || isMeeting || !isGameActive) return;
		const auth = socketIdToAuth[socket.id];
		if (!auth || deadAuths.has(auth) || impostorAuths.has(auth) || !authToPlayer[auth]?.tasks?.[taskId]) return;
		if (typeof taskProgress[taskId] === 'boolean') {
			taskProgress[taskId] = false;
		}
		recordTaskActivity(auth, taskId, false);
		emitTaskProgress();
		console.log('[task-incomplete]', { socketId: socket.id, auth, taskId });
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
		schedulePersist();
		broadcastGamemasterUpdate();
	});

	socket.on('impostor-task-complete', (taskId, completed = true) => {
		if (!socket.data.playerId || isMeeting || !isGameActive) return;
		const auth = socketIdToAuth[socket.id];
		if (!auth || !impostorAuths.has(auth) || !authToPlayer[auth]?.tasks?.[taskId]) return;
		if (!impostorCompletedTasksByAuth[auth]) impostorCompletedTasksByAuth[auth] = Object.create(null);
		impostorCompletedTasksByAuth[auth][taskId] = completed !== false;
		recordTaskActivity(auth, taskId, completed !== false);
		schedulePersist();
		broadcastGamemasterUpdate();
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
	});

    // NEW: Player marks themselves as dead
    socket.on('mark-dead', () => {
        if (!socket.data.playerId || !isGameActive) return;
        const auth = socketIdToAuth[socket.id];
        if (!auth || authToPlayer[auth]?.role !== 'Crewmate' || deadAuths.has(auth)) return;
        // Only crewmates can mark themselves as dead
        if (impostorAuths.has(auth)) return;

        deadAuths.add(auth);
		deadTaskNextCompletionAtByAuth[auth] = Date.now() +
			Math.max(1, Number(gameConfig.deadTaskCompletionIntervalSeconds || 90)) * 1000;
		scheduleDeadTaskCompletion(auth);
		persistState();
        console.log('[mark-dead]', { socketId: socket.id, auth });

        // Broadcast updated player list and alive count
        broadcastPlayersToAdmins();
        broadcastAliveCount();
        appendGameLog('player-dead', `${playerDirectory[auth]?.name || auth} was eliminated`, { playerId: auth });
        broadcastGamemasterUpdate();
		socket.emit('player-dead');
		if (hasCrewmateVictory({
			impostorAuths,
			deadAuths
		})) {
			finishGame('crewmates');
		} else if (hasImpostorVictory({
			players: authToPlayer,
			impostorAuths,
			deadAuths
		})) {
			finishGame('impostors');
		}
    });

	socket.on('disconnect', () => {
		delete killCooldownEndMsBySocketId[socket.id];
		const playerId = socket.data.playerId;
		if (playerId && playerDirectory[playerId]) {
			playerDirectory[playerId].lastSeenMs = Date.now();
			schedulePersist();
		}
		delete socketIdToAuth[socket.id];
		broadcastPlayersToAdmins();
		broadcastGamemasterUpdate();
		if (playerId) appendGameLog('player-disconnect', `${playerDirectory[playerId]?.name || playerId} disconnected`, { playerId });
	});
});

function concludeVoting() {
	if (!isMeeting || meetingResults) return;

	const tallies = Object.create(null);
	tallies['skip'] = 0;
	const livingPlayers = Object.keys(authToPlayer).filter(id => !deadAuths.has(id));
	for (const id of livingPlayers) {
		tallies[id] = 0;
	}
	for (const target of Object.values(meetingVotes)) {
		if (tallies[target] !== undefined) tallies[target] += 1;
		else tallies[target] = 1;
	}

	let maxVotes = 0;
	let topCandidate = null;
	let isTie = false;

	for (const [candidate, count] of Object.entries(tallies)) {
		if (count > maxVotes) {
			maxVotes = count;
			topCandidate = candidate;
			isTie = false;
		} else if (count === maxVotes && maxVotes > 0) {
			isTie = true;
		}
	}

	let ejected = null;
	let ejectedName = null;

	if (topCandidate && topCandidate !== 'skip' && !isTie && maxVotes > 0) {
		ejected = topCandidate;
		ejectedName = playerDirectory[ejected]?.name || ejected;
		deadAuths.add(ejected);

		if (!impostorAuths.has(ejected)) {
			deadTaskNextCompletionAtByAuth[ejected] = Date.now() +
				Math.max(1, Number(gameConfig.deadTaskCompletionIntervalSeconds || 90)) * 1000;
			scheduleDeadTaskCompletion(ejected);
		}

		for (const s of io.of('/').sockets.values()) {
			if (s.data.playerId === ejected) {
				s.emit('player-dead');
			}
		}
	}

	meetingResults = {
		tallies,
		votes: meetingVotes,
		ejected,
		ejectedName,
		tie: isTie || topCandidate === 'skip' || maxVotes === 0
	};

	io.emit('voting-results', meetingResults);
	io.emit('play-vote-result');

	if (ejected) {
		appendGameLog('player-ejected', `${ejectedName} was ejected.`, { playerId: ejected });
	} else {
		appendGameLog('voting-tie', 'No one was ejected (Skipped or tie).');
	}

	broadcastPlayersToAdmins();
	broadcastGamemasterUpdate();
	persistState();

	if (hasCrewmateVictory({ impostorAuths, deadAuths })) {
		finishGame('crewmates');
	} else if (hasImpostorVictory({ players: authToPlayer, impostorAuths, deadAuths })) {
		finishGame('impostors');
	}
}

function finishGame(winner) {
	if (!isGameActive || gameWinner || !['crewmates', 'impostors'].includes(winner)) return;
	clearDeadTaskCompletionTimers();
	gameWinner = winner;
	isGameActive = false;
	isMeeting = false;
	const winnerName = winner === 'crewmates' ? 'Crewmates' : 'Impostors';
	const notification = {
		winner,
		title: `${winnerName} win!`,
		body: winner === 'crewmates'
			? (hasCrewmateVictory({ impostorAuths, deadAuths })
				? 'All impostors have been eliminated.'
				: 'All crew tasks have been completed.')
			: 'The impostors outnumber the remaining crewmates.'
	};
	persistState();
	io.emit('game-won', notification);
	io.emit('state', getStateSnapshot(false));
	void sendPushNotification(notification.title, notification.body, 'among-us-game-won');
	console.log('[game-won]', { winner });
	appendGameLog('game-won', `${winnerName} win!`, { winner });
	persistState();
	broadcastGamemasterUpdate();
}

function generatePlayerJoinCode() {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	for (let index = 0; index < 6; index += 1) {
		code += alphabet[crypto.randomInt(alphabet.length)];
	}
	return code;
}

function clearDeadTaskCompletionTimers() {
	for (const timer of deadTaskCompletionTimers.values()) clearTimeout(timer);
	deadTaskCompletionTimers.clear();
}

function scheduleDeadTaskCompletion(auth) {
	if (deadTaskCompletionTimers.has(auth) ||
		!isGameActive ||
		!deadAuths.has(auth) ||
		impostorAuths.has(auth)) return;

	const taskIds = Object.keys(authToPlayer[auth]?.tasks || {});
	const remainingTaskIds = taskIds.filter(taskId => taskProgress[taskId] === false);
	if (remainingTaskIds.length === 0) {
		delete deadTaskNextCompletionAtByAuth[auth];
		return;
	}

	const intervalMs = Math.max(1, Number(gameConfig.deadTaskCompletionIntervalSeconds || 90)) * 1000;
	const nextAt = Number.isFinite(deadTaskNextCompletionAtByAuth[auth])
		? deadTaskNextCompletionAtByAuth[auth]
		: Date.now() + intervalMs;
	deadTaskNextCompletionAtByAuth[auth] = nextAt;
	const timer = setTimeout(() => {
		deadTaskCompletionTimers.delete(auth);
		const nextTaskId = Object.keys(authToPlayer[auth]?.tasks || {})
			.find(taskId => taskProgress[taskId] === false);
		if (!isGameActive || !deadAuths.has(auth) || !nextTaskId) {
			delete deadTaskNextCompletionAtByAuth[auth];
			schedulePersist();
			return;
		}

		taskProgress[nextTaskId] = true;
		recordTaskActivity(auth, nextTaskId, true);
		delete deadTaskNextCompletionAtByAuth[auth];
		emitTaskProgress();
		schedulePersist();
		console.log('[dead-task-complete]', { auth, taskId: nextTaskId });

		const playerSocket = Array.from(io.of('/').sockets.values())
			.find(socket => socket.data.playerId === auth);
		if (playerSocket) playerSocket.emit('tasks-completed', getCompletionMapForAuth(auth));
		broadcastGamemasterUpdate();

		const progress = getGlobalProgress();
		if (progress.total > 0 && progress.completed === progress.total) {
			finishGame('crewmates');
			return;
		}
		if (isGameActive) {
			deadTaskNextCompletionAtByAuth[auth] = Date.now() + intervalMs;
			scheduleDeadTaskCompletion(auth);
			schedulePersist();
		}
	}, Math.max(0, nextAt - Date.now()));
	deadTaskCompletionTimers.set(auth, timer);
}

function getStateSnapshot(includeAdminData) {
	return {
		isMeeting,
		isGameActive,
		emergencyCooldownEndMs,
		mapUrl: getCollectionMapUrl(selectedTaskCollectionId),
		config: includeAdminData ? gameConfig : undefined,
		sabotageEndMs,
		sabotageMode: gameConfig.sabotageMode,
		sabotageChargesRemaining,
		sabotageDefusedCount: gameConfig.sabotageMode === 'qr'
			? new Set(Array.from(sabotageDefuserAuths).map(v => v.includes(':') ? v.slice(v.indexOf(':') + 1) : v)).size
			: sabotageDefuserAuths.size,
		gameWinner,
		meetingCaller,
		votedPlayerIds: Object.keys(meetingVotes),
		meetingResults,
		playerJoinCode: includeAdminData && playerJoinCodeRequired ? playerJoinCode : undefined,
		taskCollections: includeAdminData ? getTaskCollectionsSnapshot() : undefined,
		selectedTaskCollectionId: includeAdminData ? selectedTaskCollectionId : undefined,
		players: getConnectedPlayers()
	};
}

function getGamemasterSnapshot() {
	if (!isGameActive) return { players: [], log: gameLog.slice(-200), updatedAt: Date.now() };

	const activePlayerIds = new Set(Object.keys(authToPlayer));
	const players = Object.values(playerDirectory)
		.filter(player => activePlayerIds.has(player.id))
		.map(player => {
		const info = authToPlayer[player.id] || {};
		const connected = Array.from(io.of('/').sockets.values())
			.some(socket => socket.data.playerId === player.id);
		const activity = Object.values(taskActivityByAuth[player.id] || {})
			.filter(item => item.completed && Number.isFinite(item.completedAt))
			.sort((a, b) => b.completedAt - a.completedAt)[0];
		const latestTask = activity && info.tasks?.[activity.taskId];
		const roomMatch = latestTask && latestTask.room;
		return {
			id: player.id,
			name: player.name,
			connected,
			alive: !deadAuths.has(player.id),
			role: isGameActive && info.role ? info.role : '',
			currentRoom: roomMatch || (latestTask ? 'No room specified' : 'No tasks yet'),
			lastTask: latestTask ? taskDisplayLabel(latestTask) : null,
			lastTaskAt: activity?.completedAt || null
		};
	});
	return { players, log: gameLog.slice(-200), updatedAt: Date.now() };
}

function recordTaskActivity(auth, taskId, completed) {
	if (!taskActivityByAuth[auth]) taskActivityByAuth[auth] = Object.create(null);
	const previous = taskActivityByAuth[auth][taskId] || {};
	taskActivityByAuth[auth][taskId] = {
		completed,
		completedAt: completed ? Date.now() : previous.completedAt || null,
		taskId
	};
	if (completed) {
		const label = taskDisplayLabel(authToPlayer[auth]?.tasks?.[taskId]);
		appendGameLog('task-complete', `${playerDirectory[auth]?.name || auth} completed: ${label}`, { playerId: auth, taskId, impostor: impostorAuths.has(auth) });
	}
}

function appendGameLog(type, message, details = {}) {
	gameLog.push({ id: crypto.randomUUID(), type, message, timestamp: Date.now(), ...details });
	if (gameLog.length > 200) gameLog = gameLog.slice(-200);
	broadcastGamemasterUpdate();
}

function broadcastGamemasterUpdate() {
	const snapshot = getGamemasterSnapshot();
	for (const socket of io.of('/').sockets.values()) {
		if (isAuthenticatedAdmin(socket)) socket.emit('gamemaster-update', snapshot);
	}
}

function sendPlayerSnapshot(socket, playerId) {
	const info = authToPlayer[playerId];
	if (deadAuths.has(playerId)) socket.emit('player-dead');
	if (info?.role === 'Impostor') impostorIds.add(socket.id);
	if (info?.role) socket.emit('role', info.role);
	if (info?.tasks) socket.emit('tasks', info.tasks);
	socket.emit('tasks-completed', getCompletionMapForAuth(playerId));
	for (const [taskId, progress] of Object.entries(taskActionProgressByAuth[playerId] || {})) {
		const task = authToPlayer[playerId]?.tasks?.[taskId];
		const required = task?.type === 'isbn'
			? Math.max(1, Number(task.isbnCount || 1))
			: Math.max(1, task?.qrCodes?.length || 1);
		socket.emit('task-action-progress', {
			taskId,
			completed: task?.type === 'isbn'
				? (Array.isArray(progress.approved) ? progress.approved.length : 0)
				: (Array.isArray(progress.values) ? progress.values.length : 0),
			submitted: Array.isArray(progress.values) ? progress.values.length : 0,
			required
		});
	}
	for (const entries of Object.values(bookIsbns)) {
		for (const entry of entries) {
			if (entry.playerId === playerId || (!entry.playerId && entry.playerName === playerDirectory[playerId]?.name)) {
				socket.emit('book-submitted', {
					taskId: entry.taskId,
					isbn: entry.isbn,
					title: entry.title || '',
					authors: entry.authors || '',
					approved: entry.approved === true
				});
			}
		}
	}
	socket.emit('sabotage-usage', { used: sabotageUsedAuths.has(playerId) });
	if (isSabotageActive && sabotageEndMs > Date.now()) {
		socket.emit('sabotage-started', { endMs: sabotageEndMs });
		socket.emit('sabotage-progress', { completed: sabotageDefuserAuths.size, required: 2 });
	}
	const tasks = Object.values(taskProgress);
	socket.emit('progress', tasks.length ? tasks.filter(Boolean).length / tasks.length : 0);
	if (impostorAuths.has(playerId)) {
		impostorIds.add(socket.id);
		const endMs = killCooldownEndMsByAuth[playerId] || 0;
		killCooldownEndMsBySocketId[socket.id] = endMs;
		socket.emit('kill-cooldown-updated', { endMs });
	}
	if (isMeeting) {
		socket.emit('meeting-state', {
			isMeeting: true,
			caller: meetingCaller,
			votedPlayerIds: Object.keys(meetingVotes),
			hasVoted: Boolean(meetingVotes[playerId]),
			results: meetingResults
		});
	}
}

function getPersistentSnapshot() {
	return {
		version: 1,
		adminSessions,
		collectionMaps,
		taskCollections,
		selectedTaskCollectionId,
		gameConfig,
		playerDirectory,
		pushSubscriptions,
		authToPlayer,
		taskProgress,
		isMeeting,
		isGameActive,
		emergencyCooldownEndMs,
		lastMeetingType,
		meetingCaller,
		meetingVotes,
		meetingResults,
		impostorCompletedTasksByAuth,
		impostorAuths: Array.from(impostorAuths),
		killCooldownEndMsByAuth,
		deadAuths: Array.from(deadAuths),
		deadTaskNextCompletionAtByAuth,
		isSabotageActive,
		sabotageEndMs,
		sabotageUsedAuths: Array.from(sabotageUsedAuths),
		sabotageDefuserAuths: Array.from(sabotageDefuserAuths),
		sabotageChargesRemaining,
		gameWinner,
		taskActivityByAuth,
		taskActionProgressByAuth,
		bookIsbns,
		gameLog,
		playerJoinCode
	};
}

function persistState() {
	return stateStore.write(getPersistentSnapshot());
}

function loadPersistentState() {
	try {
		const saved = stateStore.read();
		if (saved === null) {
			if (!playerJoinCode && playerJoinCodeRequired) {
				playerJoinCode = generatePlayerJoinCode();
				persistState();
			}
			return;
		}
		if (!isRecord(saved) || saved.version !== 1) {
			throw new Error('Unsupported or invalid saved-state format');
		}
		if (saved.taskCollections !== undefined && !isValidTaskCollections(saved.taskCollections)) {
			throw new Error('Saved state contains invalid task collections');
		}
		const recordFields = ['gameConfig', 'playerDirectory', 'authToPlayer', 'taskProgress', 'killCooldownEndMsByAuth'];
		if (recordFields.some(field => !isRecord(saved[field])) ||
			!Array.isArray(saved.impostorAuths) ||
			!Array.isArray(saved.deadAuths) ||
			!Array.isArray(saved.sabotageUsedAuths) ||
			(saved.sabotageDefuserAuths !== undefined && !Array.isArray(saved.sabotageDefuserAuths)) ||
			!Array.isArray(saved.gameConfig.tasks) ||
			!saved.gameConfig.tasks.every(task => typeof task === 'string' || isValidTask(task)) ||
			!Object.entries(saved.playerDirectory).every(([id, player]) =>
				isRecord(player) && player.id === id && typeof player.name === 'string' && player.name.trim() &&
				(player.token === undefined || typeof player.token === 'string')
			) ||
			!Object.values(saved.taskProgress).every(value => typeof value === 'boolean') ||
			saved.impostorAuths.concat(
				saved.deadAuths,
				saved.sabotageUsedAuths,
				saved.sabotageDefuserAuths || []
			).some(value => typeof value !== 'string')) {
			throw new Error('Saved state contains invalid player or game data');
		}
		const numericConfigKeys = [
			'numImpostors',
			'numTasksPerPlayer',
			'emergencyCooldownMinutes',
			'killCooldownSeconds',
			'maxPlayersPerTask',
			'sabotageDurationSeconds',
			'sabotageCharges',
			'deadTaskCompletionIntervalSeconds'
		];
		if (numericConfigKeys.some(key =>
			saved.gameConfig[key] !== undefined &&
			(!Number.isFinite(saved.gameConfig[key]) || saved.gameConfig[key] < 0)) ||
			(saved.gameConfig.deadTaskCompletionIntervalSeconds !== undefined &&
				saved.gameConfig.deadTaskCompletionIntervalSeconds <= 0) ||
			!Number.isFinite(saved.emergencyCooldownEndMs) ||
			!Number.isFinite(saved.sabotageEndMs) ||
			!Number.isFinite(saved.sabotageChargesRemaining) ||
			(saved.gameWinner !== undefined && saved.gameWinner !== null &&
				!['crewmates', 'impostors'].includes(saved.gameWinner)) ||
			(saved.playerJoinCode !== undefined && saved.playerJoinCode !== null &&
				(typeof saved.playerJoinCode !== 'string' || !saved.playerJoinCode.trim())) ||
			(saved.deadTaskNextCompletionAtByAuth !== undefined &&
				(!isRecord(saved.deadTaskNextCompletionAtByAuth) ||
					!Object.values(saved.deadTaskNextCompletionAtByAuth).every(Number.isFinite))) ||
			!Object.values(saved.killCooldownEndMsByAuth).every(Number.isFinite) ||
			!Object.values(saved.authToPlayer).every(player =>
				isRecord(player) && typeof player.role === 'string' && isRecord(player.tasks)
			)) {
			throw new Error('Saved state contains invalid game settings');
		}
		if (saved.pushSubscriptions !== undefined &&
			(!isRecord(saved.pushSubscriptions) ||
				!Object.values(saved.pushSubscriptions).every(subscriptions =>
					isRecord(subscriptions) && Object.values(subscriptions).every(isValidPushSubscription)
				))) {
			throw new Error('Saved state contains invalid push subscriptions');
		}
		if (saved.adminSessions !== undefined &&
			(!isRecord(saved.adminSessions) ||
				!Object.values(saved.adminSessions).every(expiresAt => Number.isFinite(expiresAt)))) {
			throw new Error('Saved state contains invalid admin sessions');
		}
		if (saved.collectionMaps !== undefined &&
			(!isRecord(saved.collectionMaps) ||
				!Object.entries(saved.collectionMaps).every(([collectionId, map]) =>
					/^[a-zA-Z0-9_-]{1,80}$/.test(collectionId) &&
					isRecord(map) &&
					/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(map.filename) &&
					['image/jpeg', 'image/png', 'image/webp'].includes(map.mimeType)
				))) {
			throw new Error('Saved state contains invalid collection maps');
		}

		if (saved.gameConfig && typeof saved.gameConfig === 'object') {
			gameConfig = { ...gameConfig, ...saved.gameConfig };
			gameConfig.tasks = Array.isArray(gameConfig.tasks) ? gameConfig.tasks.map(normalizeTask) : TASKS.map(normalizeTask);
			gameConfig.sabotageMode = gameConfig.sabotageMode === 'qr' ? 'qr' : 'button';
			gameConfig.sabotageQrCodes = Array.isArray(gameConfig.sabotageQrCodes)
				? gameConfig.sabotageQrCodes.filter(code => typeof code === 'string').map(code => code.trim()).filter(Boolean)
				: [];
		}
		if (Array.isArray(saved.taskCollections)) {
			taskCollections = saved.taskCollections.map(collection => ({
				id: collection.id,
				name: collection.name.trim(),
				tasks: collection.tasks.map(normalizeTask)
			}));
		} else {
			taskCollections = [{
				id: DEFAULT_TASK_COLLECTION_ID,
				name: 'Standard',
				tasks: gameConfig.tasks.slice()
			}];
		}
		selectedTaskCollectionId = typeof saved.selectedTaskCollectionId === 'string' &&
			taskCollections.some(collection => collection.id === saved.selectedTaskCollectionId)
			? saved.selectedTaskCollectionId
			: taskCollections[0].id;
		collectionMaps = Object.assign(Object.create(null), saved.collectionMaps || {});
		for (const collectionId of Object.keys(collectionMaps)) {
			if (!taskCollections.some(collection => collection.id === collectionId)) {
				delete collectionMaps[collectionId];
			}
		}
		playerDirectory = Object.assign(Object.create(null), saved.playerDirectory);
		pushSubscriptions = Object.assign(Object.create(null), saved.pushSubscriptions || {});
		adminSessions = Object.assign(Object.create(null), saved.adminSessions || {});
		for (const [sessionHash, expiresAt] of Object.entries(adminSessions)) {
			if (!/^[a-f0-9]{64}$/.test(sessionHash) || expiresAt <= Date.now()) {
				delete adminSessions[sessionHash];
			}
		}
		authToPlayer = Object.assign(Object.create(null), saved.authToPlayer);
		for (const player of Object.values(authToPlayer)) {
			player.tasks = Object.fromEntries(
				Object.entries(player.tasks || {}).map(([taskId, task]) => [taskId, normalizeTask(task)])
			);
		}
		if (saved.taskProgress && typeof saved.taskProgress === 'object') {
			taskProgress = Object.assign(Object.create(null), saved.taskProgress);
		}
		taskActivityByAuth = Object.assign(Object.create(null), saved.taskActivityByAuth || {});
		taskActionProgressByAuth = Object.assign(Object.create(null), saved.taskActionProgressByAuth || {});
		bookIsbns = Object.assign(Object.create(null), saved.bookIsbns || {});
		gameLog = Array.isArray(saved.gameLog) ? saved.gameLog.slice(-200) : [];
		isMeeting = saved.isMeeting === true;
		isGameActive = saved.isGameActive === true;
		emergencyCooldownEndMs = Number(saved.emergencyCooldownEndMs) || 0;
		lastMeetingType = saved.lastMeetingType || null;
		impostorAuths = new Set(Array.isArray(saved.impostorAuths) ? saved.impostorAuths : []);
		killCooldownEndMsByAuth = Object.assign(Object.create(null), saved.killCooldownEndMsByAuth);
		deadAuths = new Set(Array.isArray(saved.deadAuths) ? saved.deadAuths : []);
		deadTaskNextCompletionAtByAuth = Object.assign(
			Object.create(null),
			saved.deadTaskNextCompletionAtByAuth || {}
		);
		isSabotageActive = saved.isSabotageActive === true && Number(saved.sabotageEndMs) > Date.now();
		sabotageEndMs = isSabotageActive ? Number(saved.sabotageEndMs) : 0;
		sabotageUsedAuths = new Set(Array.isArray(saved.sabotageUsedAuths) ? saved.sabotageUsedAuths : []);
		sabotageDefuserAuths = new Set(Array.isArray(saved.sabotageDefuserAuths) ? saved.sabotageDefuserAuths : []);
		sabotageChargesRemaining = Math.max(0, Number(saved.sabotageChargesRemaining) || 0);
		gameWinner = ['crewmates', 'impostors'].includes(saved.gameWinner) ? saved.gameWinner : null;
		if (playerJoinCodeRequired) {
			playerJoinCode = typeof saved.playerJoinCode === 'string' && saved.playerJoinCode.trim()
				? saved.playerJoinCode.trim()
				: playerJoinCode || generatePlayerJoinCode();
		}
		meetingCaller = isRecord(saved.meetingCaller) ? saved.meetingCaller : null;
		meetingVotes = isRecord(saved.meetingVotes) ? saved.meetingVotes : Object.create(null);
		meetingResults = isRecord(saved.meetingResults) ? saved.meetingResults : null;
		impostorCompletedTasksByAuth = isRecord(saved.impostorCompletedTasksByAuth) ? saved.impostorCompletedTasksByAuth : Object.create(null);
		if (isSabotageActive) {
			const remainingMs = sabotageEndMs - Date.now();
			if (remainingMs <= 0) {
				isSabotageActive = false;
				sabotageEndMs = 0;
				finishGame('impostors');
			} else {
				sabotageTimeout = setTimeout(() => {
					sabotageTimeout = null;
					if (!isSabotageActive) return;
					isSabotageActive = false;
					sabotageEndMs = 0;
					io.emit('sabotage-ended', { reason: 'timeout' });
					persistState();
					finishGame('impostors');
				}, remainingMs);
			}
		}
		if (isGameActive) {
			for (const auth of deadAuths) scheduleDeadTaskCompletion(auth);
		}
		if (playerJoinCodeRequired && saved.playerJoinCode !== playerJoinCode) {
			persistState();
		}
		console.log('[persistence] Restored saved player and game state');
	} catch (error) {
		console.error('[persistence] Unable to load saved game state; starting with defaults:', error);
		try {
			if (fs.existsSync(STATE_FILE)) {
				const backupPath = `${STATE_FILE}.corrupt-${Date.now()}`;
				fs.copyFileSync(STATE_FILE, backupPath);
				console.warn(`[persistence] Backed up corrupted state file to ${backupPath}`);
			}
		} catch (backupError) {
			console.error('[persistence] Failed to backup corrupt state file:', backupError);
		}
	}
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hashAdminSession(token) {
	return crypto.createHash('sha256').update(token).digest('hex');
}

function isValidAdminSessionToken(authorization) {
	if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
	const token = authorization.slice(7);
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
	const expiresAt = adminSessions[hashAdminSession(token)];
	return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function isAuthenticatedAdmin(socket) {
	const sessionHash = socket.data.adminSessionHash;
	return socket.data.isAdmin === true &&
		typeof sessionHash === 'string' &&
		Number.isFinite(adminSessions[sessionHash]) &&
		adminSessions[sessionHash] > Date.now();
}

function removeCollectionMapFile(map) {
	if (!map || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(map.filename)) return;
	const mapPath = path.join(DATA_DIR, 'maps', map.filename);
	try {
		if (fs.existsSync(mapPath)) fs.unlinkSync(mapPath);
	} catch (error) {
		console.error('[maps] Unable to remove collection map:', error);
	}
}

function getCollectionMapUrl(collectionId) {
	return collectionMaps[collectionId]
		? `/api/maps/${encodeURIComponent(collectionId)}`
		: null;
}

function getTaskCollectionsSnapshot() {
	return taskCollections.map(collection => ({
		...collection,
		mapUrl: getCollectionMapUrl(collection.id)
	}));
}

function isValidTaskCollections(collections) {
	if (!Array.isArray(collections) || collections.length < 1 || collections.length > 100) {
		return false;
	}
	const ids = new Set();
	const names = new Set();
	return collections.every(collection => {
		if (!isRecord(collection) ||
			typeof collection.id !== 'string' ||
			!/^[a-zA-Z0-9_-]{1,80}$/.test(collection.id) ||
			typeof collection.name !== 'string' ||
			!collection.name.trim() ||
			collection.name.trim().length > 64 ||
			!Array.isArray(collection.tasks) ||
			collection.tasks.length > 500 ||
			!collection.tasks.every(isValidTask)) {
			return false;
		}

		const normalizedName = collection.name.trim().toLocaleLowerCase();
		if (ids.has(collection.id) || names.has(normalizedName)) return false;
		ids.add(collection.id);
		names.add(normalizedName);
		return true;
	});
}

function isValidPushSubscription(subscription) {
	if (!isRecord(subscription) || typeof subscription.endpoint !== 'string' ||
		!isRecord(subscription.keys) || typeof subscription.keys.p256dh !== 'string' ||
		typeof subscription.keys.auth !== 'string') {
		return false;
	}
	try {
		return new URL(subscription.endpoint).protocol === 'https:';
	} catch {
		return false;
	}
}

// Compute completion snapshot for a specific player auth
function getCompletionMapForAuth(a) {
	const info = authToPlayer[a];
	const result = {};
	if (!info || !info.tasks) return result;
	if (impostorAuths.has(a)) {
		const impMap = impostorCompletedTasksByAuth[a] || {};
		for (const taskId of Object.keys(info.tasks)) {
			result[taskId] = !!impMap[taskId];
		}
		return result;
	}
	for (const taskId of Object.keys(info.tasks)) {
		result[taskId] = !!taskProgress[taskId];
	}
	return result;
}

// NEW: Helper functions for player tracking
function getConnectedPlayers() {
	const connectedPlayerIds = new Set();
	for (const socket of io.of('/').sockets.values()) {
		if (socket.data.playerId) connectedPlayerIds.add(socket.data.playerId);
	}
	return Object.values(playerDirectory)
		.map(player => ({
			id: player.id,
			name: player.name,
			connected: connectedPlayerIds.has(player.id),
			alive: !deadAuths.has(player.id),
			inGame: isGameActive ? Boolean(authToPlayer[player.id]) : true
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function broadcastPlayersToAdmins() {
	const players = getConnectedPlayers();
	io.emit('players-updated', players);
}

function broadcastAdminState() {
	const state = getStateSnapshot(true);
	for (const socket of io.of('/').sockets.values()) {
		if (isAuthenticatedAdmin(socket)) socket.emit('state', state);
	}
}

function broadcastAliveCount() {
	const aliveCount = Object.keys(authToPlayer)
		.filter(playerId => !deadAuths.has(playerId)).length;

	for (const [id, socket] of io.of('/').sockets) {
		if (socket.data.playerId && impostorIds.has(id)) {
			socket.emit('alive-count', { count: aliveCount });
		}
	}

	console.log('[alive-count]', { count: aliveCount });
}

server.listen(PORT, () => console.log(`Server listening on *:${PORT}`));