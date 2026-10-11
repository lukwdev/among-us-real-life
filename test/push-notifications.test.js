const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushNotifier } = require('../src/push-notifications');

test('sends push notifications with a category tag to saved subscriptions', async () => {
	const sent = [];
	const subscriptions = {
		player: { browser: { endpoint: 'https://push.example/subscription' } }
	};
	const notify = createPushNotifier({
		webPush: {
			sendNotification: async (...args) => sent.push(args)
		},
		isEnabled: true,
		getSubscriptions: () => subscriptions,
		removeSubscription: () => {},
		persistState: () => {}
	});

	await notify('Crewmates win!', 'All tasks are complete.', 'among-us-game-won');

	assert.equal(sent.length, 1);
	assert.deepEqual(JSON.parse(sent[0][1]), {
		title: 'Crewmates win!',
		body: 'All tasks are complete.',
		url: '/',
		tag: 'among-us-game-won'
	});
});
