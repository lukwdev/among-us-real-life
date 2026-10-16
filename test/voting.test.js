const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateVotingResults } = require('../src/voting');

test('ejects the player with the highest vote count when there is no tie', () => {
	const livingPlayerIds = ['alice', 'bob', 'charlie'];
	const votes = {
		alice: 'bob',
		charlie: 'bob',
		bob: 'alice'
	};
	const playerNames = {
		alice: 'Alice',
		bob: 'Bob',
		charlie: 'Charlie'
	};

	const result = calculateVotingResults({ livingPlayerIds, votes, playerNames });

	assert.equal(result.ejected, 'bob');
	assert.equal(result.ejectedName, 'Bob');
	assert.equal(result.tie, false);
	assert.equal(result.tallies.bob, 2);
	assert.equal(result.tallies.alice, 1);
	assert.equal(result.tallies.skip, 0);
});

test('results in a tie when two players receive the same highest number of votes', () => {
	const livingPlayerIds = ['alice', 'bob', 'charlie', 'david'];
	const votes = {
		alice: 'bob',
		charlie: 'bob',
		bob: 'david',
		david: 'david'
	};

	const result = calculateVotingResults({ livingPlayerIds, votes });

	assert.equal(result.ejected, null);
	assert.equal(result.ejectedName, null);
	assert.equal(result.tie, true);
	assert.equal(result.tallies.bob, 2);
	assert.equal(result.tallies.david, 2);
});

test('results in no ejection when skip has the most votes', () => {
	const livingPlayerIds = ['alice', 'bob', 'charlie'];
	const votes = {
		alice: 'skip',
		bob: 'skip',
		charlie: 'bob'
	};

	const result = calculateVotingResults({ livingPlayerIds, votes });

	assert.equal(result.ejected, null);
	assert.equal(result.ejectedName, null);
	assert.equal(result.tie, true);
	assert.equal(result.tallies.skip, 2);
	assert.equal(result.tallies.bob, 1);
});

test('handles empty votes with no ejection', () => {
	const livingPlayerIds = ['alice', 'bob'];
	const votes = {};

	const result = calculateVotingResults({ livingPlayerIds, votes });

	assert.equal(result.ejected, null);
	assert.equal(result.tie, true);
	assert.equal(result.tallies.alice, 0);
	assert.equal(result.tallies.bob, 0);
	assert.equal(result.tallies.skip, 0);
});
