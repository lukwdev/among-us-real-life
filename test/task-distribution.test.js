const test = require('node:test');
const assert = require('node:assert/strict');
const { distributeTasks } = require('../src/task-distribution');

test('assigns requested number of tasks per player without duplicates', () => {
	const playerAuths = ['player-1', 'player-2', 'player-3'];
	const tasksPool = [
		{ id: 't1', label: 'Wires', room: 'Electrical', type: 'manual' },
		{ id: 't2', label: 'Shields', room: 'Shields', type: 'manual' },
		{ id: 't3', label: 'Asteroids', room: 'Weapons', type: 'manual' },
		{ id: 't4', label: 'Oxygen', room: 'O2', type: 'manual' },
		{ id: 't5', label: 'Engines', room: 'Reactor', type: 'manual' }
	];

	const { playerTasks, taskProgress } = distributeTasks({
		playerAuths,
		tasksPool,
		impostorAuths: new Set(['player-3']),
		numTasksPerPlayer: 3,
		maxPlayersPerTask: 2
	});

	for (const auth of playerAuths) {
		const assigned = Object.values(playerTasks[auth]);
		assert.equal(assigned.length, 3);

		// Ensure uniqueness per player
		const taskIds = new Set(assigned.map(t => t.id));
		assert.equal(taskIds.size, 3);
	}

	// Crewmates' tasks are in taskProgress (player-1 and player-2: 3 each = 6 total)
	assert.equal(Object.keys(taskProgress).length, 6);
	assert.ok(Object.values(taskProgress).every(val => val === false));

	// Impostor tasks are not in taskProgress
	const impTaskIds = Object.keys(playerTasks['player-3']);
	for (const id of impTaskIds) {
		assert.equal(taskProgress[id], undefined);
	}
});

test('respects maxPlayersPerTask when pool has sufficient tasks', () => {
	const playerAuths = ['p1', 'p2', 'p3', 'p4'];
	const tasksPool = [
		{ id: 't1', label: 'Task 1', room: '', type: 'manual' },
		{ id: 't2', label: 'Task 2', room: '', type: 'manual' },
		{ id: 't3', label: 'Task 3', room: '', type: 'manual' },
		{ id: 't4', label: 'Task 4', room: '', type: 'manual' },
		{ id: 't5', label: 'Task 5', room: '', type: 'manual' },
		{ id: 't6', label: 'Task 6', room: '', type: 'manual' }
	];

	const { assignedCountByTask } = distributeTasks({
		playerAuths,
		tasksPool,
		numTasksPerPlayer: 2,
		maxPlayersPerTask: 2
	});

	for (const count of Object.values(assignedCountByTask)) {
		assert.ok(count <= 2, `Task count was ${count}, expected <= 2`);
	}
});

test('gracefully handles empty playerAuths or tasksPool', () => {
	const result1 = distributeTasks({ playerAuths: [], tasksPool: [{ id: '1' }] });
	assert.deepEqual(result1.playerTasks, {});

	const result2 = distributeTasks({ playerAuths: ['p1'], tasksPool: [] });
	assert.deepEqual(result2.playerTasks, {});
});
