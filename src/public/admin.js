const socket = io({
	query: {
		role: 'ADMIN'
	}
});

const login$ = document.querySelector('#admin-login');
const adminCode$ = document.querySelector('#admin-code');
const loginError$ = document.querySelector('#login-error');
const dashboard$ = document.querySelector('#admin-dashboard');
const startGame$ = document.querySelector('#start-game');
const players$ = document.querySelector('#players');
const playerCount$ = document.querySelector('#player-count');
const adminError$ = document.querySelector('#admin-error');

function renderPlayers(players) {
	const connectedCount = players.filter(player => player.connected).length;
	playerCount$.textContent = `${connectedCount} connected / ${players.length} total`;
	players$.replaceChildren();
	for (const player of players) {
		const item = document.createElement('li');
		item.textContent = `${player.name}: ${player.connected ? 'Connected' : 'Offline'}${player.alive ? '' : ' · Dead'}`;
		players$.appendChild(item);
	}
}

socket.on('state', state => {
	if (Array.isArray(state?.players)) renderPlayers(state.players);
});

socket.on('players-updated', players => {
	if (Array.isArray(players)) renderPlayers(players);
});

socket.on('start-error', error => {
	adminError$.textContent = error?.reason === 'no-players'
		? 'At least one player must be connected before starting.'
		: 'The game could not be started.';
});

login$.addEventListener('submit', event => {
	event.preventDefault();
	socket.timeout(10000).emit('admin-login', { code: adminCode$.value }, (timeoutError, response) => {
		if (timeoutError || !response?.ok) {
			loginError$.textContent = response?.reason === 'admin-not-configured'
				? 'ADMIN_CODE is not configured on the server.'
				: 'The admin code is incorrect or the server could not verify it.';
			return;
		}
		loginError$.textContent = '';
		login$.hidden = true;
		dashboard$.hidden = false;
		socket.emit('get-state');
	});
});

startGame$.addEventListener('click', () => {
	adminError$.textContent = '';
	socket.emit('start-game');
});

/**
 * Sounds
 */

async function wait(milliseconds) {
	await new Promise(resolve => {
		setTimeout(() => resolve(), milliseconds);
	});
}

const SOUNDS = {
	meeting: new Audio('/sounds/meeting.mp3'),
	sabotage: new Audio('/sounds/sabotage.mp3'),
	start: new Audio('/sounds/start.mp3'),
	sussyBoy: new Audio('/sounds/sussy-boy.mp3'),
	voteResult: new Audio('/sounds/vote-result.mp3'),
	youLose: new Audio('/sounds/you-lose.mp3'),
	youWin: new Audio('/sounds/you-win.mp3')
};

socket.on('play-meeting', async () => {
	await SOUNDS.meeting.play();
	await wait(2000);
	await SOUNDS.sussyBoy.play();
});

socket.on('play-win', async () => {
	await SOUNDS.youWin.play();
});
