// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Client } from 'discord.js';
import { logger } from '#lib/logger.js';

export function heartbeat(client: Client) {
	const pushURLs =
		process.env.KUMA_PUSH_URL?.split(',')
			.map((u) => u.trim())
			.filter(Boolean) ?? [];
	const shardId = client.shard?.ids?.[0] ?? 0;
	const pushURL = pushURLs[shardId];

	const push = async () => {
		if (!pushURL || !client.isReady()) return;

		try {
			const url = new URL(pushURL);
			url.searchParams.set('ping', String(Math.max(0, client.ws.ping)));
			url.searchParams.set('status', 'up');

			const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			if (!response.ok) {
				logger.error(`[heartbeat] Shard ${shardId} push failed: ${response.status}`);
			}
		} catch (err) {
			logger.error(`[heartbeat] Shard ${shardId} push error:`, err);
		}
	};

	const loop = async () => {
		await push();
		setTimeout(loop, 60_000);
	};
	void loop();
}
