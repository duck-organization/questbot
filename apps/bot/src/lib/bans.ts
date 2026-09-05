// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '@questbot/database';
import { type Guild, PermissionFlagsBits } from 'discord.js';

export async function createBan(
	guildId: string,
	guildName: string,
	userId: string,
	expiresAt: Date | null,
	reason?: string,
) {
	await prisma.server.upsert({
		where: { id: guildId },
		create: { id: guildId, name: guildName },
		update: { name: guildName },
	});
	return prisma.ban.upsert({
		where: { guildId_userId: { guildId, userId } },
		create: { guildId, userId, expiresAt, reason },
		update: { expiresAt, reason },
	});
}

export async function clearBans(guildId: string, userId: string) {
	return prisma.ban.deleteMany({
		where: { guildId, userId },
	});
}

export async function getBan(guildId: string, userId: string) {
	return prisma.ban.findUnique({
		where: { guildId_userId: { guildId, userId } },
	});
}

export async function getBans() {
	return prisma.ban.findMany({
		where: {
			OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
		},
	});
}

export async function applyBan(guild: Guild, userId: string, reason?: string): Promise<boolean> {
	const me = guild.members.me;
	if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) return false;

	try {
		await guild.bans.create(userId, { reason: reason ?? undefined });
		return true;
	} catch {
		return false;
	}
}

export async function removeBan(guild: Guild, userId: string): Promise<boolean> {
	const me = guild.members.me;
	if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) return false;

	try {
		await guild.bans.remove(userId);
	} catch {}

	await clearBans(guild.id, userId);
	return true;
}
