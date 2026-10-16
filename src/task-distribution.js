const crypto = require('node:crypto');
const _ = require('lodash');

function defaultTaskKey(task) {
	return task?.id || `${task?.type}:${task?.label}:${task?.room}`;
}

function distributeTasks({
	playerAuths = [],
	tasksPool = [],
	impostorAuths = new Set(),
	numTasksPerPlayer = 3,
	maxPlayersPerTask = 2,
	taskKey = defaultTaskKey,
	generateTaskId = () => crypto.randomUUID()
} = {}) {
	if (!Array.isArray(playerAuths) || playerAuths.length === 0 || !Array.isArray(tasksPool) || tasksPool.length === 0) {
		return { playerTasks: {}, taskProgress: {}, assignedCountByTask: {} };
	}

	const impostorSet = impostorAuths instanceof Set ? impostorAuths : new Set(impostorAuths);
	const maxPerTask = Math.max(1, Number(maxPlayersPerTask || 2));
	const desiredTaskCount = Math.max(1, Number(numTasksPerPlayer || 1));
	const tasksPerPlayer = Math.min(desiredTaskCount, Math.max(1, tasksPool.length));

	const assignedCountByTask = Object.create(null);
	for (const t of tasksPool) {
		assignedCountByTask[taskKey(t)] = 0;
	}

	const playerTaskLabels = Object.create(null);
	const playerTasks = Object.create(null);
	const taskProgress = Object.create(null);

	for (const a of playerAuths) {
		playerTaskLabels[a] = new Set();
		playerTasks[a] = Object.create(null);
	}

	for (let i = 0; i < tasksPerPlayer; i++) {
		for (const a of playerAuths) {
			const labelSet = playerTaskLabels[a];
			const eligible = tasksPool.filter(task => {
				const key = taskKey(task);
				return !labelSet.has(key) && (assignedCountByTask[key] || 0) < maxPerTask;
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

			const key = taskKey(task);
			labelSet.add(key);
			assignedCountByTask[key] = (assignedCountByTask[key] || 0) + 1;

			const taskId = generateTaskId();
			playerTasks[a][taskId] = task;

			if (!impostorSet.has(a)) {
				taskProgress[taskId] = false;
			}
		}
	}

	return {
		playerTasks,
		taskProgress,
		assignedCountByTask
	};
}

module.exports = { distributeTasks };
