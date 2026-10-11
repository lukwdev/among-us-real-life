const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameProgress } = require('../src/game-progress');

test('publishes global task progress and announces a newly completed game', () => {
	const emitted = [];
	let taskProgress = { first: false, second: false };
	const progress = createGameProgress({
		io: { emit: (...event) => emitted.push(event) },
		getTaskProgress: () => taskProgress
	});

	progress.emitTaskProgress();
	assert.deepEqual(emitted, [
		['progress', 0],
		['global-progress', { completed: 0, total: 2, ratio: 0 }]
	]);

	taskProgress = { first: true, second: true };
	progress.emitTaskProgress({ announceWin: true });
	assert.deepEqual(emitted.slice(2), [
		['progress', 1],
		['global-progress', { completed: 2, total: 2, ratio: 1 }],
		['play-win']
	]);
});

test('does not announce a win for an empty task set', () => {
	const emitted = [];
	const progress = createGameProgress({
		io: { emit: (...event) => emitted.push(event) },
		getTaskProgress: () => ({})
	});

	progress.emitTaskProgress({ announceWin: true });

	assert.deepEqual(emitted, [
		['progress', 0],
		['global-progress', { completed: 0, total: 0, ratio: 0 }]
	]);
});
