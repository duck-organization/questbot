// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { type Collection, EmbedBuilder, Events, type Message, type PartialMessage, type Snowflake } from 'discord.js';
import { removeConfessionContexts } from '#lib/confessions.js';
import { deleteGiveawaysByMessageIds } from '#lib/giveaways.js';
import { isLoggingChannel, logEmbed } from '#lib/logging.js';
import { removeStarboardPostsByMessages } from '#lib/starboard.js';

export class MessageDeleteBulkListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.MessageBulkDelete });
	}

	public async run(messages: Collection<Snowflake, Message<true> | PartialMessage<true>>) {
		const first = messages.first();
		const guild = first?.guild;
		if (!guild) return;
		if (await isLoggingChannel(guild, first?.channel?.id)) return;

		const channel = first?.channel?.toString() ?? 'Unknown';

		const embed = new EmbedBuilder()
			.setTitle('Bulk Messages Deleted')
			.setColor(0xff6962)
			.addFields(
				{ name: 'Channel', value: channel, inline: true },
				{ name: 'Count', value: `${messages.size}`, inline: true },
			)
			.setTimestamp();

		await removeConfessionContexts([...messages.keys()]).catch(() => null);
		await deleteGiveawaysByMessageIds([...messages.keys()]).catch(() => null);
		await removeStarboardPostsByMessages(guild, [...messages.keys()]).catch(() => null);
		await logEmbed(guild, embed);
	}
}
