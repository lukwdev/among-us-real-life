const test = require('node:test');
const assert = require('node:assert/strict');
const { hasImpostorVictory, hasCrewmateVictory } = require('../src/game-outcome');

test('crewmates win when all impostors are eliminated', () => {
	assert.equal(hasCrewmateVictory({
		impostorAuths: ['imp1', 'imp2'],
		deadAuths: ['imp1']
	}), false);
	assert.equal(hasCrewmateVictory({
		impostorAuths: ['imp1', 'imp2'],
		deadAuths: ['imp1', 'imp2']
	}), true);
	assert.equal(hasCrewmateVictory({
		impostorAuths: [],
		deadAuths: []
	}), false);
});

test('impostors win when they equal or outnumber the living crewmates', () => {
	const players = {
		imp: { role: 'Impostor' },
		crew1: { role: 'Crewmate' },
		crew2: { role: 'Crewmate' },
		crew3: { role: 'Crewmate' }
	};
	assert.equal(hasImpostorVictory({
		players,
		impostorAuths: ['imp'],
		deadAuths: ['crew1']
	}), false);
	assert.equal(hasImpostorVictory({
		players,
		impostorAuths: ['imp'],
		deadAuths: ['crew1', 'crew2']
	}), true);
});

test('does not declare an impostor victory for games without living impostors or crew', () => {
	const players = {
		imp: { role: 'Impostor' },
		crew: { role: 'Crewmate' }
	};
	assert.equal(hasImpostorVictory({
		players,
		impostorAuths: ['imp'],
		deadAuths: ['imp']
	}), false);
	assert.equal(hasImpostorVictory({
		players: {
			imp: { role: 'Impostor' },
			crew: { role: 'Crewmate' }
		},
		impostorAuths: ['imp'],
		deadAuths: ['imp', 'crew']
	}), false);
	assert.equal(hasImpostorVictory({
		players: { imp: { role: 'Impostor' } },
		impostorAuths: ['imp'],
		deadAuths: []
	}), false);
});
