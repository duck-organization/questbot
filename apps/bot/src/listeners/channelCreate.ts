// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { AuditLogEvent, type Channel, EmbedBuilder, Events } from 'discord.js';
import { getRecentAuditLogEntry, isLoggingChannel, logEmbed } from '#lib/logging.js';

export class ChannelCreateListener extends Listener<typeof Events.ChannelCreate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			event: Events.ChannelCreate,
		});
	}

	public async run(channel: Channel) {
		if (!('guild' in channel) || !channel.guild) return;

		if (await isLoggingChannel(channel.guild, channel.id)) return;

		const channelId = channel.id;
		const typeLabel = String(channel.type);

		const embed = new EmbedBuilder()
			.setTitle('Channel Created')
			.setColor(0x77dd76)
			.addFields(
				{ name: 'Channel', value: `<#${channelId}>`, inline: true },
				{ name: 'Type', value: typeLabel, inline: true },
			)
			.setTimestamp();

		const auditEntry = await getRecentAuditLogEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

		if (auditEntry?.executor) {
			embed.addFields({ name: 'Moderator', value: `<@${auditEntry.executor.id}>`, inline: true });
		}

		await logEmbed(channel.guild, embed);
	}
}
