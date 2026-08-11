// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { type APIEmbedField, AuditLogEvent, type Channel, EmbedBuilder, Events } from 'discord.js';
import { removeConfessionContextsByChannel } from '#lib/confessions.js';
import { getRecentAuditLogEntry, isLoggingChannel, logEmbed } from '#lib/logging.js';
import { getSettings, updateSettings } from '#lib/settings.js';
import { clearStarboardEntries, removeStarboardPostsByChannel } from '#lib/starboard.js';

export class ChannelDeleteListener extends Listener<typeof Events.ChannelDelete> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			event: Events.ChannelDelete,
		});
	}

	public async run(channel: Channel) {
		if (!('guild' in channel) || !channel.guild) return;

		await removeConfessionContextsByChannel(channel.id).catch(() => null);

		const settings = await getSettings(channel.guild.id).catch(() => null);

		if (settings?.starboardChannelId === channel.id) {
			await clearStarboardEntries(channel.guild.id).catch(() => null);
			await updateSettings(channel.guild.id, channel.guild.name, { starboardChannelId: null }).catch((err) =>
				console.error(err),
			);
		} else {
			await removeStarboardPostsByChannel(channel.guild, channel.id).catch(() => null);
		}

		if (settings?.honeypotChannelId === channel.id) {
			await updateSettings(channel.guild.id, channel.guild.name, { honeypotChannelId: null }).catch((err) =>
				console.error(err),
			);
		}

		if (await isLoggingChannel(channel.guild, channel.id)) return;

		const channelLabel = channel.toString() || 'Unknown';
		const typeLabel = String(channel.type);
		const fields: APIEmbedField[] = [
			{ name: 'Channel', value: `${channelLabel} (${channel.id})`, inline: true },
			{ name: 'Type', value: typeLabel, inline: true },
		];

		const embed = new EmbedBuilder().setTitle('Channel Deleted').setColor(0xff6962).addFields(fields).setTimestamp();

		const auditEntry = await getRecentAuditLogEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

		if (auditEntry?.executor) {
			embed.addFields({ name: 'Moderator', value: `<@${auditEntry.executor.id}>`, inline: true });
		}

		await logEmbed(channel.guild, embed);
	}
}
