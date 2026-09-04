#!/usr/bin/env node
// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ShardingManager } from 'discord.js';
import { logger } from '#lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shardFile = join(__dirname, 'index.js');

const shardCountEnv = process.env.SHARD_COUNT;
let totalShards: number | 'auto' | undefined;
if (shardCountEnv) {
	if (shardCountEnv === 'auto') totalShards = 'auto';
	else {
		const parsed = Number(shardCountEnv);
		if (Number.isInteger(parsed) && parsed > 0) totalShards = parsed;
	}
}

if (totalShards !== undefined) {
	logger.log(`Shard count: ${shardCountEnv}`);
} else {
	logger.log('No shard count provided using what Discord recommends.');
}

const manager = new ShardingManager(shardFile, {
	token: process.env.DISCORD_TOKEN,
	...(totalShards ? { totalShards } : {}),
});

manager.on('shardCreate', (shard) => {
	logger.log(`Launched shard ${shard.id}`);
});

void manager.spawn();
