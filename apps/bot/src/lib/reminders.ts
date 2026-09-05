// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '@questbot/database';
import { LIMITS_ENABLED, LimitError } from './limits.js';

export async function createReminder(
	userId: string,
	message: string,
	remindAt: Date,
	guildId?: string,
	guildName?: string,
	channelId?: string,
) {
	if (LIMITS_ENABLED) {
		const reminderCount = await prisma.reminder.count({ where: { userId } });

		if (reminderCount >= 5) {
			throw new LimitError('You can only have up to 5 reminders.');
		}
	}

	if (guildId && guildName) {
		await prisma.server.upsert({
			where: { id: guildId },
			create: { id: guildId, name: guildName },
			update: { name: guildName },
		});
		return prisma.reminder.create({
			data: { guildId, userId, channelId, message, remindAt },
		});
	}
	return prisma.reminder.create({
		data: { userId, channelId, message, remindAt },
	});
}

export async function getReminders(userId: string, guildId?: string) {
	return prisma.reminder.findMany({
		where: { userId, guildId },
		orderBy: { remindAt: 'asc' },
	});
}

export async function removeReminder(reminderId: string) {
	return prisma.reminder.delete({ where: { id: reminderId } });
}

export async function clearReminders(guildId: string, userId: string) {
	return prisma.reminder.deleteMany({ where: { guildId, userId } });
}

export async function getReminder(reminderId: string) {
	return prisma.reminder.findUnique({ where: { id: reminderId } });
}
