// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Client } from 'discord.js';
import { getChannel } from '#utils/getChannel.js';
import { startShardedPoller } from '#utils/sharding.js';
import { buildGiveawayEmbed, type FinishGiveawayResult, finishGiveaway, getDueGiveaways } from './giveaways.js';
import { logger } from './logger.js';

export function giveawayScheduler(client: Client) {
	startShardedPoller({
		client,
		getDue: getDueGiveaways,
		handle: (giveaway) => endGiveaway(client, giveaway.id).then(() => undefined),
	});
}

export async function endGiveaway(client: Client, giveawayId: string): Promise<FinishGiveawayResult> {
	const result = await finishGiveaway(giveawayId);
	if (result.status !== 'ended') return result;

	const ended = result.giveaway;
	const channel = await getChannel(client.channels, ended.channelId);

	if (channel?.isSendable()) {
		if (ended.messageId) {
			const message = await channel.messages.fetch(ended.messageId).catch(() => null);
			if (message) {
				await message.edit({ embeds: [buildGiveawayEmbed(ended)], components: [] }).catch(() => {});
			}
		}

		if (ended.winnerIds.length) {
			await channel
				.send({
					content: `Congratulations ${ended.winnerIds.map((id) => `<@${id}>`).join(', ')}! You've won **${ended.prize}**!`,
					allowedMentions: { users: ended.winnerIds },
					...(ended.messageId ? { reply: { messageReference: ended.messageId } } : {}),
				})
				.catch((err) => logger.error(err));
		} else {
			await channel
				.send({
					content: `The giveaway for **${ended.prize}** ended with no entries.`,
					allowedMentions: { parse: [] },
				})
				.catch((err) => logger.error(err));
		}
	}

	return result;
}
