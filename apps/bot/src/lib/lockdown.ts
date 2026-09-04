// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '@questbot/database';
import {
	EmbedBuilder,
	type Guild,
	type GuildTextBasedChannel,
	PermissionFlagsBits,
	type ThreadChannel,
} from 'discord.js';
import { logger } from '#lib/logger.js';
import { getSettings } from '#lib/settings.js';

export type LockdownResult = { affected: number; skipped: number };

type LockableChannel = Exclude<GuildTextBasedChannel, ThreadChannel>;

export async function isServerLocked(guildId: string): Promise<boolean> {
	const server = await prisma.server.findUnique({ where: { id: guildId }, select: { locked: true } });

	return server?.locked ?? false;
}

export async function isChannelLocked(channelId: string): Promise<boolean> {
	const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { locked: true } });

	return channel?.locked ?? false;
}

// checked so lock and lockdown dont mess eachother up
export async function isChannelLockedDown(channelId: string): Promise<boolean> {
	const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { lockedDown: true } });

	return channel?.lockedDown ?? false;
}

export async function lockChannel(channel: LockableChannel, reason: string): Promise<boolean> {
	const guild = channel.guild;
	const me = guild.members.me;
	if (!me) return false;

	if (!channel.isSendable() || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageRoles)) return false;

	try {
		await channel.permissionOverwrites.edit(
			guild.roles.everyone,
			{ SendMessages: false, SendMessagesInThreads: false },
			{ reason },
		);
	} catch (error) {
		logger.error(error);
		return false;
	}

	const notice = new EmbedBuilder()
		.setTitle('Channel Locked')
		.setColor(0xff6962)
		.setDescription('This channel has been locked by server administrators.');

	const message = await channel.send({ embeds: [notice] }).catch((err) => {
		logger.error(err);
		return null;
	});

	await prisma.server.upsert({
		where: { id: guild.id },
		create: { id: guild.id, name: guild.name },
		update: { name: guild.name },
	});

	await prisma.channel.upsert({
		where: { id: channel.id },
		create: { id: channel.id, guildId: guild.id, locked: true, lockdownMessageId: message?.id ?? null },
		update: { locked: true, lockdownMessageId: message?.id ?? null },
	});

	return true;
}

export async function unlockChannel(channel: LockableChannel, reason: string): Promise<boolean> {
	const row = await prisma.channel.findUnique({ where: { id: channel.id } });

	try {
		await channel.permissionOverwrites.edit(
			channel.guild.roles.everyone,
			{ SendMessages: null, SendMessagesInThreads: null },
			{ reason },
		);
	} catch (error) {
		logger.error(error);
		return false;
	}

	if (row?.lockdownMessageId) await channel.messages.delete(row.lockdownMessageId).catch(() => {});

	await prisma.channel.update({
		where: { id: channel.id },
		data: { locked: false, lockdownMessageId: null },
	});

	return true;
}

export async function lockdownServer(guild: Guild, reason: string): Promise<LockdownResult> {
	const me = guild.members.me;
	if (!me) return { affected: 0, skipped: 0 };

	const everyone = guild.roles.everyone;
	const settings = await getSettings(guild.id);

	await prisma.server.upsert({
		where: { id: guild.id },
		create: { id: guild.id, name: guild.name, locked: true },
		update: { name: guild.name, locked: true },
	});

	const notice = new EmbedBuilder()
		.setTitle('Lockdown')
		.setColor(0xff6962)
		.setDescription('The server has been locked by server administrators.')
		.setFooter({ text: 'This affects all channels everyone can speak in.' });

	const channels = await guild.channels.fetch();

	let affected = 0;
	let skipped = 0;

	for (const channel of channels.values()) {
		if (!channel?.isTextBased() || channel.isThread()) continue;
		if (channel.id === settings.honeypotChannelId) continue;

		const everyonePerms = channel.permissionsFor(everyone);
		if (!everyonePerms.has(PermissionFlagsBits.ViewChannel)) continue;
		if (!everyonePerms.has(PermissionFlagsBits.SendMessages)) continue;
		if (!everyonePerms.has(PermissionFlagsBits.SendMessagesInThreads)) continue;

		if (!channel.isSendable() || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageRoles)) {
			skipped++;
			continue;
		}

		try {
			await channel.permissionOverwrites.edit(
				everyone,
				{ SendMessages: false, SendMessagesInThreads: false },
				{ reason },
			);
		} catch (error) {
			logger.error(error);
			skipped++;
			continue;
		}

		const message = await channel.send({ embeds: [notice] }).catch((err) => {
			logger.error(err);
			return null;
		});

		await prisma.channel.upsert({
			where: { id: channel.id },
			create: {
				id: channel.id,
				guildId: guild.id,
				lockedDown: true,
				lockdownMessageId: message?.id ?? null,
			},
			update: { lockedDown: true, lockdownMessageId: message?.id ?? null },
		});

		affected++;
	}

	return { affected, skipped };
}

export async function unLockdown(guild: Guild, reason: string): Promise<LockdownResult> {
	const everyone = guild.roles.everyone;
	const locked = await prisma.channel.findMany({ where: { guildId: guild.id, lockedDown: true } });

	let affected = 0;
	let skipped = 0;

	for (const row of locked) {
		const channel = guild.channels.cache.get(row.id) ?? (await guild.channels.fetch(row.id).catch(() => null));

		if (channel?.isTextBased() && !channel.isThread()) {
			try {
				// null clears the overwrite
				await channel.permissionOverwrites.edit(
					everyone,
					{ SendMessages: null, SendMessagesInThreads: null },
					{ reason },
				);

				if (row.lockdownMessageId) await channel.messages.delete(row.lockdownMessageId).catch(() => {});

				affected++;
			} catch (error) {
				logger.error(error);
				skipped++;
			}
		}

		await prisma.channel.update({
			where: { id: row.id },
			data: { lockedDown: false, lockdownMessageId: null },
		});
	}

	await prisma.server.updateMany({ where: { id: guild.id }, data: { locked: false } });

	return { affected, skipped };
}
