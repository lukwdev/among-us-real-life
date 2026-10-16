function calculateVotingResults({ livingPlayerIds = [], votes = {}, playerNames = {} } = {}) {
	const tallies = Object.create(null);
	tallies['skip'] = 0;
	for (const id of livingPlayerIds) {
		tallies[id] = 0;
	}
	for (const target of Object.values(votes)) {
		if (tallies[target] !== undefined) {
			tallies[target] += 1;
		} else {
			tallies[target] = 1;
		}
	}

	let maxVotes = 0;
	let topCandidate = null;
	let isTie = false;

	for (const [candidate, count] of Object.entries(tallies)) {
		if (count > maxVotes) {
			maxVotes = count;
			topCandidate = candidate;
			isTie = false;
		} else if (count === maxVotes && maxVotes > 0) {
			isTie = true;
		}
	}

	let ejected = null;
	let ejectedName = null;

	if (topCandidate && topCandidate !== 'skip' && !isTie && maxVotes > 0) {
		ejected = topCandidate;
		ejectedName = playerNames[ejected] || ejected;
	}

	return {
		tallies,
		votes,
		ejected,
		ejectedName,
		tie: isTie || topCandidate === 'skip' || maxVotes === 0
	};
}

module.exports = { calculateVotingResults };
