// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '@questbot/database';

export async function softDeleteServer(guildId: string) {
	return prisma.server.update({ where: { id: guildId }, data: { deletedAt: new Date() } }).catch(() => null);
}

export async function restoreServer(guildId: string) {
	return prisma.server.update({ where: { id: guildId }, data: { deletedAt: null } }).catch(() => null);
}

export async function purgeDeletedServers(gracePeriodDays = 30) {
	const cutoff = new Date(Date.now() - gracePeriodDays * 24 * 60 * 60 * 1000);
	const { count } = await prisma.server.deleteMany({
		where: { deletedAt: { not: null, lte: cutoff } },
	});
	return count;
}
