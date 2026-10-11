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
const { hasImpostorVictory } = require('./game-outcome');
const { createJsonStore } = require('./json-store');
const { createPushNotifier } = require('./push-notifications');

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
	tasks: TASKS.slice()
}];
let selectedTaskCollectionId = DEFAULT_TASK_COLLECTION_ID;
let gameConfig = {
	tasks: TASKS,
	numImpostors: N_IMPOSTORS,
	numTasksPerPlayer: DEFAULT_TASKS_PER_PLAYER,
	emergencyCooldownMinutes: 1,
	killCooldownSeconds: 20,
	// Max number of players that can receive the same task label
	maxPlayersPerTask: 2,
	// New: sabotage duration in seconds
	sabotageDurationSeconds: 20,
	// New: shared sabotage charges for all impostors
	sabotageCharges: 2
};
let emergencyCooldownEndMs = 0;
let lastMeetingType = null; // 'emergency' | 'report' | null
let impostorIds = new Set();
let killCooldownEndMsBySocketId = {};
// Auth-based mappings for reconnect/rehydration
let socketIdToAuth = {};
let authToPlayer = Object.create(null); // auth -> { role: string, tasks: { [taskId]: label } }
let impostorAuths = new Set();
let killCooldownEndMsByAuth = Object.create(null);
// Sabotage state
let isSabotageActive = false;
let sabotageEndMs = 0;
let sabotageTimeout = null;
let sabotageUsedAuths = new Set();
let sabotageChargesRemaining = 0;

let deadAuths = new Set();
let gameWinner = null;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'game-state.json');
const stateStore = createJsonStore(STATE_FILE);
let playerDirectory = Object.create(null);
let pushSubscriptions = Object.create(null);
let adminSessions = Object.create(null);
let collectionMaps = Object.create(null);
const ADMIN_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
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
		if (isAuthenticatedAdmin(socket)) socket.emit('global-progress', getGlobalProgress());
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
			return;
		}

		if (!adminCode) {
			return reply({ ok: false, reason: 'admin-not-configured' });
		}

		const submittedCode = typeof payload?.code === 'string' ? Buffer.from(payload.code) : Buffer.alloc(0);
		const configuredCode = typeof adminCode === 'string' ? Buffer.from(adminCode) : Buffer.alloc(0);
		const valid = submittedCode.length === configuredCode.length &&
			crypto.timingSafeEqual(submittedCode, configuredCode);
		if (!valid) {
			return reply({ ok: false, reason: 'invalid-code' });
		}

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
			const submittedCode = typeof payload?.code === 'string' ? Buffer.from(payload.code) : Buffer.alloc(0);
			const configuredCode = Buffer.from(playerJoinCode);
			const valid = submittedCode.length === configuredCode.length &&
				crypto.timingSafeEqual(submittedCode, configuredCode);
			if (!valid) {
				return reply({ ok: false, reason: 'invalid-player-code' });
			}
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

		const existingPlayer = playerDirectory[playerKey];
		if (!existingPlayer) {
			playerDirectory[playerKey] = { id: playerKey, name, lastSeenMs: Date.now() };
			if (!persistState()) {
				delete playerDirectory[playerKey];
				return reply({ ok: false, reason: 'persistence-unavailable' });
			}
		} else if (existingPlayer.name !== name) {
			const previousName = existingPlayer.name;
			existingPlayer.name = name;
			if (!persistState()) {
				existingPlayer.name = previousName;
				return reply({ ok: false, reason: 'persistence-unavailable' });
			}
		}

		socket.data.playerId = playerKey;
		socketIdToAuth[socket.id] = playerKey;
		reply({ ok: true, id: playerKey, name: playerDirectory[playerKey].name });
		socket.emit('state', getStateSnapshot(false));
		sendPlayerSnapshot(socket, playerKey);
		broadcastPlayersToAdmins();
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
			tasks: collection.tasks.map(task => task.trim())
		}));
		const retainedIds = new Set(taskCollections.map(collection => collection.id));
		collectionMaps = Object.assign(Object.create(null), collectionMaps);
		for (const collectionId of Object.keys(collectionMaps)) {
			if (!retainedIds.has(collectionId)) delete collectionMaps[collectionId];
		}
		selectedTaskCollectionId = selectedCollection.id;
		gameConfig.tasks = selectedCollection.tasks.slice();
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
		killCooldownEndMsByAuth = Object.create(null);
		killCooldownEndMsBySocketId = {};
        //Reset dead players
        deadAuths = new Set();
		// Reset sabotage state
		isSabotageActive = false;
		sabotageEndMs = 0;
		sabotageUsedAuths = new Set();
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
		const tasksPool = Array.isArray(gameConfig.tasks) ? gameConfig.tasks.slice() : [];
		const maxPerTask = Math.max(1, Number(gameConfig.maxPlayersPerTask || 2));
		const desiredTaskCount = Math.max(1, Number(gameConfig.numTasksPerPlayer || DEFAULT_TASKS_PER_PLAYER));
		const tasksPerPlayer = Math.min(desiredTaskCount, Math.max(1, tasksPool.length || 1));
		const assignedCountByTask = Object.create(null);
		for (const t of tasksPool) assignedCountByTask[t] = 0;

		// Track each player's assigned labels to enforce uniqueness
		const playerTaskLabels = Object.create(null);
		const playerTasks = Object.create(null);
		taskProgress = {};
		for (const a of uniqueAuths) {
			playerTaskLabels[a] = new Set();
			playerTasks[a] = {};
		}

		for (let i = 0; i < tasksPerPlayer; i++) {
			for (const a of uniqueAuths) {
				const labelSet = playerTaskLabels[a];
				const eligible = tasksPool.filter(taskLabel => {
					return !labelSet.has(taskLabel) && (assignedCountByTask[taskLabel] || 0) < maxPerTask;
				});
				let candidates = eligible;
				if (candidates.length === 0) {
					candidates = tasksPool.filter(taskLabel => !labelSet.has(taskLabel));
				}
				if (candidates.length === 0) {
					continue;
				}
				const minCount = Math.min(...candidates.map(taskLabel => assignedCountByTask[taskLabel] || 0));
				const taskLabel = _.shuffle(candidates.filter(taskLabel => (assignedCountByTask[taskLabel] || 0) === minCount))[0];
				if (!taskLabel) continue;

				labelSet.add(taskLabel);
				assignedCountByTask[taskLabel] = (assignedCountByTask[taskLabel] || 0) + 1;

				const taskId = crypto.randomUUID();
				playerTasks[a][taskId] = taskLabel;
				console.log('[assign-task]', { auth: a, taskId, taskLabel });
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
		io.emit('cooldown-updated', { emergencyCooldownEndMs });
		persistState();
		console.log('[game-started]');
	});

	socket.on('report', () => {
		if (!socket.data.playerId || !isGameActive || isMeeting) return;
		if (deadAuths.has(socketIdToAuth[socket.id])) return;
		isMeeting = true;
		lastMeetingType = 'report';
		io.emit('play-meeting');
		io.emit('meeting-started');
		void sendPushNotification('Meeting called', 'Return to the game now.', 'among-us-meeting');
		persistState();
		console.log('[report]', { socketId: socket.id, auth: socketIdToAuth[socket.id] });
	});

	socket.on('emergency-meeting', () => {
		if ((!socket.data.playerId && !isAuthenticatedAdmin(socket)) || !isGameActive || isMeeting) return;
		if (socket.data.playerId && deadAuths.has(socketIdToAuth[socket.id])) return;
		if (Date.now() < emergencyCooldownEndMs) return;
		isMeeting = true;
		lastMeetingType = 'emergency';
		io.emit('play-meeting');
		io.emit('meeting-started');
		void sendPushNotification('Emergency meeting', 'Return to the game now.', 'among-us-meeting');
		persistState();
		console.log('[emergency-meeting]', { socketId: socket.id, auth: socketIdToAuth[socket.id] });
	});

	socket.on('continue-game', () => {
		if (!isAuthenticatedAdmin(socket) || !isGameActive) return;
		isMeeting = false;
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
		// Clear sabotage
		isSabotageActive = false;
		sabotageEndMs = 0;
		sabotageUsedAuths = new Set();
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
		gameWinner = null;
		emitTaskProgress();
		io.emit('game-ended');
		io.emit('state', getStateSnapshot(false));
		io.emit('cooldown-updated', { emergencyCooldownEndMs });
		persistState();
		broadcastPlayersToAdmins();
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
		persistState();
		console.log('[kill]', { socketId: socket.id, auth: a, endMs: killCooldownEndMsBySocketId[socket.id] });
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
		const endMs = Date.now() + durationMs;
		isSabotageActive = true;
		sabotageEndMs = endMs;
		sabotageUsedAuths.add(a);
		sabotageChargesRemaining = Math.max(0, sabotageChargesRemaining - 1);
		io.emit('sabotage-started', { endMs });
		io.emit('sabotage-charges', { remaining: sabotageChargesRemaining });
		// Also inform this impostor they've used their sabotage
		socket.emit('sabotage-usage', { used: true });
		persistState();
		if (sabotageTimeout) clearTimeout(sabotageTimeout);
		sabotageTimeout = setTimeout(() => {
			isSabotageActive = false;
			sabotageEndMs = 0;
			io.emit('sabotage-ended');
			sabotageTimeout = null;
			persistState();
		}, durationMs);
	});

	socket.on('task-complete', taskId => {
		if (!socket.data.playerId || isMeeting || !isGameActive) return;
		const auth = socketIdToAuth[socket.id];
		if (!auth || deadAuths.has(auth) || impostorAuths.has(auth) || !authToPlayer[auth]?.tasks?.[taskId]) return;
		const isNewlyCompleted = taskProgress[taskId] === false;
		if (typeof taskProgress[taskId] === 'boolean') {
			taskProgress[taskId] = true;
		}
		emitTaskProgress();
		console.log('[task-complete]', { socketId: socket.id, auth, taskId });
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
		const progress = getGlobalProgress();
		if (isNewlyCompleted && progress.total > 0 && progress.completed === progress.total) {
			finishGame('crewmates');
		}
		persistState();
	});

	socket.on('task-incomplete', taskId => {
		if (!socket.data.playerId || isMeeting || !isGameActive) return;
		const auth = socketIdToAuth[socket.id];
		if (!auth || deadAuths.has(auth) || impostorAuths.has(auth) || !authToPlayer[auth]?.tasks?.[taskId]) return;
		if (typeof taskProgress[taskId] === 'boolean') {
			taskProgress[taskId] = false;
		}
		emitTaskProgress();
		console.log('[task-incomplete]', { socketId: socket.id, auth, taskId });
		socket.emit('tasks-completed', getCompletionMapForAuth(auth));
		persistState();
	});

    // NEW: Player marks themselves as dead
    socket.on('mark-dead', () => {
        if (!socket.data.playerId || !isGameActive) return;
        const auth = socketIdToAuth[socket.id];
        if (!auth || authToPlayer[auth]?.role !== 'Crewmate' || deadAuths.has(auth)) return;
        // Only crewmates can mark themselves as dead
        if (impostorAuths.has(auth)) return;

        deadAuths.add(auth);
		persistState();
        console.log('[mark-dead]', { socketId: socket.id, auth });

        // Broadcast updated player list and alive count
        broadcastPlayersToAdmins();
        broadcastAliveCount();
		socket.emit('player-dead');
		if (hasImpostorVictory({
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
			persistState();
		}
		delete socketIdToAuth[socket.id];
		broadcastPlayersToAdmins();
	});
});

function finishGame(winner) {
	if (!isGameActive || gameWinner || !['crewmates', 'impostors'].includes(winner)) return;
	gameWinner = winner;
	isGameActive = false;
	isMeeting = false;
	const winnerName = winner === 'crewmates' ? 'Crewmates' : 'Impostors';
	const notification = {
		winner,
		title: `${winnerName} win!`,
		body: winner === 'crewmates'
			? 'All crew tasks have been completed.'
			: 'The impostors outnumber the remaining crewmates.'
	};
	persistState();
	io.emit('game-won', notification);
	io.emit('state', getStateSnapshot(false));
	void sendPushNotification(notification.title, notification.body, 'among-us-game-won');
	console.log('[game-won]', { winner });
}

function generatePlayerJoinCode() {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	for (let index = 0; index < 6; index += 1) {
		code += alphabet[crypto.randomInt(alphabet.length)];
	}
	return code;
}

function getStateSnapshot(includeAdminData) {
	return {
		isMeeting,
		isGameActive,
		emergencyCooldownEndMs,
		mapUrl: getCollectionMapUrl(selectedTaskCollectionId),
		config: includeAdminData ? gameConfig : undefined,
		sabotageEndMs,
		sabotageChargesRemaining,
		gameWinner,
		playerJoinCode: includeAdminData && playerJoinCodeRequired ? playerJoinCode : undefined,
		taskCollections: includeAdminData ? getTaskCollectionsSnapshot() : undefined,
		selectedTaskCollectionId: includeAdminData ? selectedTaskCollectionId : undefined,
		players: includeAdminData ? getConnectedPlayers() : undefined
	};
}

function sendPlayerSnapshot(socket, playerId) {
	const info = authToPlayer[playerId];
	if (deadAuths.has(playerId)) socket.emit('player-dead');
	if (info?.role === 'Impostor') impostorIds.add(socket.id);
	if (info?.role) socket.emit('role', info.role);
	if (info?.tasks) socket.emit('tasks', info.tasks);
	socket.emit('tasks-completed', getCompletionMapForAuth(playerId));
	socket.emit('sabotage-usage', { used: sabotageUsedAuths.has(playerId) });
	if (isSabotageActive && sabotageEndMs > Date.now()) {
		socket.emit('sabotage-started', { endMs: sabotageEndMs });
	}
	const tasks = Object.values(taskProgress);
	socket.emit('progress', tasks.length ? tasks.filter(Boolean).length / tasks.length : 0);
	if (impostorAuths.has(playerId)) {
		impostorIds.add(socket.id);
		const endMs = killCooldownEndMsByAuth[playerId] || 0;
		killCooldownEndMsBySocketId[socket.id] = endMs;
		socket.emit('kill-cooldown-updated', { endMs });
	}
}

function persistState() {
	const snapshot = {
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
		impostorAuths: Array.from(impostorAuths),
		killCooldownEndMsByAuth,
		deadAuths: Array.from(deadAuths),
		isSabotageActive,
		sabotageEndMs,
		sabotageUsedAuths: Array.from(sabotageUsedAuths),
		sabotageChargesRemaining,
		gameWinner,
		playerJoinCode
	};
	return stateStore.write(snapshot);
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
			!Array.isArray(saved.gameConfig.tasks) ||
			!saved.gameConfig.tasks.every(task => typeof task === 'string') ||
			!Object.entries(saved.playerDirectory).every(([id, player]) =>
				isRecord(player) && player.id === id && typeof player.name === 'string' && player.name.trim()
			) ||
			!Object.values(saved.taskProgress).every(value => typeof value === 'boolean') ||
			saved.impostorAuths.concat(saved.deadAuths, saved.sabotageUsedAuths).some(value => typeof value !== 'string')) {
			throw new Error('Saved state contains invalid player or game data');
		}
		const numericConfigKeys = [
			'numImpostors',
			'numTasksPerPlayer',
			'emergencyCooldownMinutes',
			'killCooldownSeconds',
			'maxPlayersPerTask',
			'sabotageDurationSeconds',
			'sabotageCharges'
		];
		if (numericConfigKeys.some(key => !Number.isFinite(saved.gameConfig[key]) || saved.gameConfig[key] < 0) ||
			!Number.isFinite(saved.emergencyCooldownEndMs) ||
			!Number.isFinite(saved.sabotageEndMs) ||
			!Number.isFinite(saved.sabotageChargesRemaining) ||
			(saved.gameWinner !== undefined && saved.gameWinner !== null &&
				!['crewmates', 'impostors'].includes(saved.gameWinner)) ||
			(saved.playerJoinCode !== undefined && saved.playerJoinCode !== null &&
				(typeof saved.playerJoinCode !== 'string' || !saved.playerJoinCode.trim())) ||
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
			if (!Array.isArray(gameConfig.tasks)) gameConfig.tasks = TASKS;
		}
		if (Array.isArray(saved.taskCollections)) {
			taskCollections = saved.taskCollections.map(collection => ({
				id: collection.id,
				name: collection.name.trim(),
				tasks: collection.tasks.map(task => task.trim())
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
		if (saved.taskProgress && typeof saved.taskProgress === 'object') {
			taskProgress = Object.assign(Object.create(null), saved.taskProgress);
		}
		isMeeting = saved.isMeeting === true;
		isGameActive = saved.isGameActive === true;
		emergencyCooldownEndMs = Number(saved.emergencyCooldownEndMs) || 0;
		lastMeetingType = saved.lastMeetingType || null;
		impostorAuths = new Set(Array.isArray(saved.impostorAuths) ? saved.impostorAuths : []);
		killCooldownEndMsByAuth = Object.assign(Object.create(null), saved.killCooldownEndMsByAuth);
		deadAuths = new Set(Array.isArray(saved.deadAuths) ? saved.deadAuths : []);
		isSabotageActive = saved.isSabotageActive === true && Number(saved.sabotageEndMs) > Date.now();
		sabotageEndMs = isSabotageActive ? Number(saved.sabotageEndMs) : 0;
		sabotageUsedAuths = new Set(Array.isArray(saved.sabotageUsedAuths) ? saved.sabotageUsedAuths : []);
		sabotageChargesRemaining = Math.max(0, Number(saved.sabotageChargesRemaining) || 0);
		gameWinner = ['crewmates', 'impostors'].includes(saved.gameWinner) ? saved.gameWinner : null;
		if (playerJoinCodeRequired) {
			playerJoinCode = typeof saved.playerJoinCode === 'string' && saved.playerJoinCode.trim()
				? saved.playerJoinCode.trim()
				: playerJoinCode || generatePlayerJoinCode();
		}
		if (isSabotageActive) {
			sabotageTimeout = setTimeout(() => {
				isSabotageActive = false;
				sabotageEndMs = 0;
				io.emit('sabotage-ended');
				sabotageTimeout = null;
				persistState();
			}, Math.max(0, sabotageEndMs - Date.now()));
		}
		if (playerJoinCodeRequired && saved.playerJoinCode !== playerJoinCode) {
			persistState();
		}
		console.log('[persistence] Restored saved player and game state');
	} catch (error) {
		console.error('[persistence] Unable to load saved game state; starting with defaults:', error);
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
			!collection.tasks.every(task => typeof task === 'string' && task.trim().length > 0 && task.trim().length <= 200)) {
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
			alive: !deadAuths.has(player.id)
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function broadcastPlayersToAdmins() {
	const players = getConnectedPlayers();
	for (const socket of io.of('/').sockets.values()) {
		if (isAuthenticatedAdmin(socket)) {
			socket.emit('players-updated', players);
		}
	}
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