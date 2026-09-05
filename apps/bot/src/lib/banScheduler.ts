// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, prisma } from '@questbot/database';
import type { Client } from 'discord.js';
import { getShardInfo, type ShardInfo, shardOwns } from '#utils/sharding.js';
import { removeBan } from './bans.js';
import { logger } from './logger.js';
import { createShardQueue } from './queue.js';

interface UnbanJob {
	guildId: string;
	userId: string;
}

let queue: ReturnType<typeof createShardQueue<UnbanJob>> | undefined;

export function initBanScheduler(client: Client): void {
	queue = createShardQueue<UnbanJob>('unbans', client, async (job) => {
		const guild = client.guilds.cache.get(job.data.guildId);
		if (guild) {
			await removeBan(guild, job.data.userId);
		} else {
			// we no longer share a guild with them, nothing to unban on discord's side
			await prisma.ban.deleteMany({ where: { guildId: job.data.guildId, userId: job.data.userId } });
		}
	});

	// catches up on bans created before this shard last started, in case redis lost the job
	// (e.g. a fresh redis, or this ban predates the scheduler existing at all)
	reconcile(getShardInfo(client)).catch((err) => logger.error(err));
}

async function reconcile(shard: ShardInfo): Promise<void> {
	const pending = await prisma.$queryRaw<Prisma.BanModel[]>`
		SELECT * FROM "Ban"
		WHERE "expiresAt" IS NOT NULL
			AND ${shardOwns(Prisma.sql`"guildId"::bigint`, shard)}
	`;

	for (const ban of pending) {
		await scheduleUnban(ban);
	}
}

export async function scheduleUnban(ban: {
	id: string;
	guildId: string;
	userId: string;
	expiresAt: Date | null;
}): Promise<void> {
	if (!ban.expiresAt || !queue) return;

	// re-banning an existing row keeps its id, so drop any stale job before adding
	// the new one - otherwise BullMQ treats a repeated jobId as a no-op and the
	// old expiry sticks around
	await unscheduleUnban(ban.id);

	const delay = Math.max(0, ban.expiresAt.getTime() - Date.now());
	await queue.add(
		'unban',
		{ guildId: ban.guildId, userId: ban.userId },
		{ jobId: ban.id, delay, removeOnComplete: true, removeOnFail: true },
	);
}

export async function unscheduleUnban(banId: string): Promise<void> {
	const job = await queue?.getJob(banId);
	await job?.remove().catch(() => {});
}
