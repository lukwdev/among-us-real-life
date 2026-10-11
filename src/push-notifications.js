function createPushNotifier({ webPush, isEnabled, getSubscriptions, removeSubscription, persistState }) {
	return async function sendPushNotification(title, body, tag = 'among-us-notification') {
		if (!isEnabled) return;
		const notification = JSON.stringify({ title, body, url: '/', tag });
		for (const [playerId, subscriptions] of Object.entries(getSubscriptions())) {
			for (const [subscriptionId, subscription] of Object.entries(subscriptions)) {
				try {
					await webPush.sendNotification(subscription, notification, { TTL: 120, urgency: 'high' });
				} catch (error) {
					if (error.statusCode === 404 || error.statusCode === 410) {
						removeSubscription(playerId, subscriptionId);
						persistState();
					} else {
						console.error('[push] Unable to send notification:', error);
					}
				}
			}
		}
	};
}

module.exports = { createPushNotifier };
