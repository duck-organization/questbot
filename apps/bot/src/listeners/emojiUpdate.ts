// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { AuditLogEvent, EmbedBuilder, Events, type GuildEmoji } from 'discord.js';
import { getRecentAuditLogEntry, logEmbed } from '#lib/logging.js';

export class EmojiUpdateListener extends Listener<typeof Events.GuildEmojiUpdate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			event: Events.GuildEmojiUpdate,
		});
	}

	public async run(oldEmoji: GuildEmoji, newEmoji: GuildEmoji) {
		const auditEntry = await getRecentAuditLogEntry(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);

		const embed = new EmbedBuilder()
			.setTitle('Emoji Updated')
			.setColor(0xfac898)
			.addFields({ name: 'Emoji', value: `${newEmoji}`, inline: true })
			.setFooter({ text: `ID: ${newEmoji.id}` })
			.setTimestamp();

		if (oldEmoji.name !== newEmoji.name) {
			embed.addFields(
				{ name: 'Before', value: `\`${oldEmoji.name}\`` },
				{ name: 'After', value: `\`${newEmoji.name}\`` },
			);
		}

		if (auditEntry?.executor) {
			embed.addFields({ name: 'Moderator', value: `<@${auditEntry.executor.id}>`, inline: true });
		}

		await logEmbed(newEmoji.guild, embed);
	}
}
