// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { EmbedBuilder, Events, type Message, type PartialMessage } from 'discord.js';
import { removeConfessionContext } from '#lib/confessions.js';
import { deleteGiveawayByMessageId } from '#lib/giveaways.js';
import { isLoggingChannel, logEmbed, truncate } from '#lib/logging.js';

export class MessageDeleteListener extends Listener<typeof Events.MessageDelete> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.MessageDelete });
	}

	public async run(message: Message | PartialMessage) {
		const guild = message.guild;
		if (!guild) return;
		if (await isLoggingChannel(guild, message.channel?.id)) return;

		const content = message instanceof Object ? (message as Message).content : undefined;
		const imageUrls = [...message.attachments.values()]
			.filter((attachment) => attachment.contentType?.startsWith('image/'))
			.map((attachment) => attachment.url);
		const contentParts = [content, ...imageUrls].filter(Boolean) as string[];
		const contentValue = truncate(contentParts.join('\n'), 1024) || '-';

		const embed = new EmbedBuilder()
			.setTitle('Message Deleted')
			.setColor(0xff6962)
			.addFields(
				{ name: 'Channel', value: message.channel?.toString() ?? 'Unknown', inline: true },
				{ name: 'Author', value: message.author ? `<@${message.author.id}>` : 'Unknown', inline: true },
				{ name: 'Content', value: contentValue },
			)
			.setFooter({ text: `ID: ${message.id}` })
			.setTimestamp();

		await removeConfessionContext(message.id).catch(() => null);
		await deleteGiveawayByMessageId(message.id).catch(() => null);
		await logEmbed(guild, embed);
	}
}
