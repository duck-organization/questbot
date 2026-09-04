// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Command } from '@sapphire/framework';
import type {
	Collection,
	EmbedBuilder,
	Message,
	MessageComponentInteraction,
	MessageComponentType,
	MessageMentionOptions,
	Snowflake,
} from 'discord.js';
import { logger } from '#lib/logger.js';

export async function awaitMessageComponentSafe(
	message: Message,
	options: { filter?: (i: MessageComponentInteraction) => boolean; time?: number },
): Promise<MessageComponentInteraction | null> {
	return new Promise((resolve) => {
		const collector = message.createMessageComponentCollector<MessageComponentType>({
			filter: options.filter ?? (() => true),
			time: options.time ?? 60_000,
		});
		collector.on('error', (err: unknown) => {
			logger.debug('[awaitMessageComponentSafe] collector error', err);
			resolve(null);
		});

		collector.on('collect', (i: MessageComponentInteraction) => {
			collector.stop('collected');
			resolve(i);
		});

		collector.on('end', (collected: Collection<Snowflake, MessageComponentInteraction>, reason: string) => {
			if (reason === 'time' || collected.size === 0) {
				resolve(null);
			}
		});
	});
}

// defers the confirm button, runs the action, then edits the original reply with the
// success/error embed; a failure editing the success embed still falls through to the
// error embed since it's caught by the same try/catch
export async function runConfirmedAction(
	confirmation: MessageComponentInteraction,
	interaction: Command.ChatInputCommandInteraction,
	action: () => Promise<void>,
	reply: { success: EmbedBuilder; error: EmbedBuilder; allowedMentions: MessageMentionOptions },
	onError: (err: unknown) => void = logger.error,
): Promise<void> {
	await confirmation.deferUpdate();

	try {
		await action();
		await interaction.editReply({ embeds: [reply.success], allowedMentions: reply.allowedMentions, components: [] });
	} catch (err) {
		onError(err);
		await interaction
			.editReply({ embeds: [reply.error], allowedMentions: reply.allowedMentions, components: [] })
			.catch((editErr: unknown) => logger.error(editErr));
	}
}

export default awaitMessageComponentSafe;
