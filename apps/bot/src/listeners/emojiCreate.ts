// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { AuditLogEvent, EmbedBuilder, Events, type GuildEmoji } from 'discord.js';
import { getRecentAuditLogEntry, logEmbed } from '#lib/logging.js';

export class EmojiCreateListener extends Listener<typeof Events.GuildEmojiCreate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			event: Events.GuildEmojiCreate,
		});
	}

	public async run(emoji: GuildEmoji) {
		const auditEntry = await getRecentAuditLogEntry(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);

		const embed = new EmbedBuilder()
			.setTitle('Emoji Created')
			.setColor(0x77dd76)
			.addFields({ name: 'Emoji', value: `${emoji} \`${emoji.name}\``, inline: true })
			.setFooter({ text: `ID: ${emoji.id}` })
			.setTimestamp();

		if (auditEntry?.executor) {
			embed.addFields({ name: 'Moderator', value: `<@${auditEntry.executor.id}>`, inline: true });
		}

		await logEmbed(emoji.guild, embed);
	}
}
