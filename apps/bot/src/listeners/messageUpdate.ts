// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { EmbedBuilder, Events, type Message, type PartialMessage } from 'discord.js';
import { isLoggingChannel, logEmbed, truncate } from '#lib/logging.js';

export class MessageUpdateListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.MessageUpdate });
	}

	public async run(oldMsg: Message | PartialMessage, newMsg: Message) {
		const guild = newMsg.guild ?? oldMsg?.guild;
		if (!guild) return;

		//* this one line is important, it ignores our own messages as we consider them noise
		if (newMsg.author?.id === newMsg.client.user.id) return;

		if (await isLoggingChannel(guild, newMsg.channel?.id ?? oldMsg?.channel?.id)) return;

		const oldContent = oldMsg?.content ?? '';
		const newContent = newMsg.content ?? '';

		if (oldContent === newContent) return;

		const oldImageUrls = [...(oldMsg?.attachments.values() ?? [])]
			.filter((attachment) => attachment.contentType?.startsWith('image/'))
			.map((attachment) => attachment.url);
		const newImageUrls = [...newMsg.attachments.values()]
			.filter((attachment) => attachment.contentType?.startsWith('image/'))
			.map((attachment) => attachment.url);

		const beforeParts = [oldMsg?.content, ...oldImageUrls].filter(Boolean) as string[];
		const afterParts = [newMsg.content, ...newImageUrls].filter(Boolean) as string[];

		const beforeValue = truncate(beforeParts.join('\n'), 1024) || '-';
		const afterValue = truncate(afterParts.join('\n'), 1024) || '-';

		const embed = new EmbedBuilder()
			.setTitle('Message Edited')
			.setColor(0xfac898)
			.addFields(
				{ name: 'Message', value: newMsg.url ?? 'Unknown', inline: true },
				{ name: 'Author', value: newMsg.author?.tag ?? oldMsg?.author?.tag ?? 'Unknown', inline: true },
				{ name: 'Before', value: beforeValue },
				{ name: 'After', value: afterValue },
			)
			.setFooter({ text: `ID: ${newMsg.id}` })
			.setTimestamp();

		await logEmbed(guild, embed);
	}
}
