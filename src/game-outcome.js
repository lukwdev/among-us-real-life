function hasImpostorVictory({ players, impostorAuths, deadAuths }) {
	const impostorSet = new Set(impostorAuths);
	const deadSet = new Set(deadAuths);
	const crewAuths = Object.entries(players)
		.filter(([auth, player]) => player.role === 'Crewmate' && !impostorSet.has(auth))
		.map(([auth]) => auth);
	if (crewAuths.length === 0) return false;

	const livingCrew = crewAuths.filter(auth => !deadSet.has(auth)).length;
	const livingImpostors = Object.entries(players)
		.filter(([auth, player]) =>
			player.role === 'Impostor' && impostorSet.has(auth) && !deadSet.has(auth)
		).length;
	return livingImpostors > 0 && livingImpostors >= livingCrew;
}

module.exports = { hasImpostorVictory };
