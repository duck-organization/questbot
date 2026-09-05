// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Processor, Queue, Worker } from 'bullmq';
import type { Client } from 'discord.js';
import { getShardInfo } from '#utils/sharding.js';
import { logger } from './logger.js';
import { connection } from './redis.js';

export function createShardQueue<T>(name: string, client: Client, processor: Processor<T>) {
	const queueName = `${name}-shard-${getShardInfo(client).shardId}`;
	const queue = new Queue<T>(queueName, { connection });
	const worker = new Worker<T>(queueName, processor, { connection });

	worker.on('error', (err) => logger.error(err));

	return queue;
}
