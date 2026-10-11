const socket = io({
	query: {
		role: 'ADMIN'
	}
});

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
