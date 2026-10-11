function createGameProgress({ io, getTaskProgress }) {
	function getGlobalProgress() {
		const tasks = Object.values(getTaskProgress());
		const completed = tasks.filter(Boolean).length;
		return {
			completed,
			total: tasks.length,
			ratio: tasks.length ? completed / tasks.length : 0
		};
	}

	function emitTaskProgress() {
		const progress = getGlobalProgress();
		io.emit('progress', progress.ratio);
		io.emit('global-progress', progress);
		console.log('[progress]', progress);
	}

	return { emitTaskProgress, getGlobalProgress };
}

module.exports = { createGameProgress };
