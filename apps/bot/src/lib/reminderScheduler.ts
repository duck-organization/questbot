// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, prisma } from '@questbot/database';
import type { Client } from 'discord.js';
import { emojis } from '#utils/emoji.js';
import { getShardInfo, type ShardInfo, shardOwns } from '#utils/sharding.js';
import { logger } from './logger.js';
import { createShardQueue } from './queue.js';
import { removeReminder } from './reminders.js';

interface ReminderJob {
	id: string;
	userId: string;
	channelId: string | null;
	message: string;
}

let queue: ReturnType<typeof createShardQueue<ReminderJob>> | undefined;

export function initReminderScheduler(client: Client): void {
	queue = createShardQueue<ReminderJob>('reminders', client, async (job) => {
		await handleReminder(client, job.data);
	});

	reconcile(getShardInfo(client)).catch((err) => logger.error(err));
}

async function reconcile(shard: ShardInfo): Promise<void> {
	const pending = await prisma.$queryRaw<Prisma.ReminderModel[]>`
		SELECT * FROM "Reminder"
		WHERE ${shardOwns(Prisma.sql`COALESCE("guildId", "userId")::bigint`, shard)}
	`;

	for (const reminder of pending) {
		await scheduleReminder(reminder);
	}
}

export async function scheduleReminder(reminder: {
	id: string;
	userId: string;
	channelId: string | null;
	message: string;
	remindAt: Date;
}): Promise<void> {
	if (!queue) return;

	await unscheduleReminder(reminder.id);

	const delay = Math.max(0, reminder.remindAt.getTime() - Date.now());
	await queue.add(
		'remind',
		{ id: reminder.id, userId: reminder.userId, channelId: reminder.channelId, message: reminder.message },
		{ jobId: reminder.id, delay, removeOnComplete: true, removeOnFail: true },
	);
}

export async function unscheduleReminder(reminderId: string): Promise<void> {
	const job = await queue?.getJob(reminderId);
	await job?.remove().catch(() => {});
}

async function handleReminder(client: Client, reminder: ReminderJob) {
	let sent = false;
	if (reminder.channelId) {
		const channel = client.channels.cache.get(reminder.channelId);
		if (channel?.isSendable()) {
			await channel.send({
				content: `${emojis.rightArrow2} <@${reminder.userId}> reminder: ${reminder.message}`,
				allowedMentions: { users: [reminder.userId] },
			});
			sent = true;
		}
	}
	if (!sent) {
		await dmUser(client, reminder.userId, reminder.message);
	}

	await removeReminder(reminder.id).catch(() => {});
}

async function dmUser(client: Client, userId: string, message: string) {
	const user = await client.users.fetch(userId).catch(() => null);
	if (!user) return;

	await user
		.send({
			content: `${emojis.rightArrow2} <@${userId}> reminder: ${message}`,
			allowedMentions: { users: [userId] },
		})
		.catch(() => {});
}
