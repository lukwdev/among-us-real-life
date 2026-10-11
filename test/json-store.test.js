const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonStore } = require('../src/json-store');

test('reads missing state and atomically persists JSON state', t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'among-us-json-store-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

	const statePath = path.join(directory, 'nested', 'game-state.json');
	const store = createJsonStore(statePath);
	assert.equal(store.read(), null);

	const state = { version: 1, players: ['Crewmate'] };
	assert.equal(store.write(state), true);
	assert.deepEqual(store.read(), state);
	assert.equal(fs.existsSync(`${statePath}.tmp`), false);
});

test('reports invalid JSON instead of silently returning defaults', t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'among-us-json-store-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

	const statePath = path.join(directory, 'game-state.json');
	fs.writeFileSync(statePath, '{ invalid json');
	const store = createJsonStore(statePath);

	assert.throws(() => store.read(), SyntaxError);
});
