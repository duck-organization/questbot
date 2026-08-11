// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '@questbot/database';
import { EmbedBuilder, type Guild, PermissionFlagsBits } from 'discord.js';
import { HONEYPOT_CHANNEL_NAME } from '#lib/honeypot.js';

export type LockdownResult = { affected: number; skipped: number };

export async function isServerLocked(guildId: string): Promise<boolean> {
	const server = await prisma.server.findUnique({ where: { id: guildId }, select: { locked: true } });

	return server?.locked ?? false;
}

export async function lockdownServer(guild: Guild, reason: string): Promise<LockdownResult> {
	const me = guild.members.me;
	if (!me) return { affected: 0, skipped: 0 };

	const everyone = guild.roles.everyone;

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
		if (channel.name === HONEYPOT_CHANNEL_NAME) continue; // the trap only works while it stays open

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
			console.error(error);
			skipped++;
			continue;
		}

		const message = await channel.send({ embeds: [notice] }).catch((err) => {
			console.error(err);
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
				console.error(error);
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
