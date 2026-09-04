// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class SuggestCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder.setName('suggest').setDescription('Get the link to suggest a feature for Quest Bot!'),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const url = process.env.SUGGESTIONS_URL ?? '';

		if (!url) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Suggestions have not been setup for this bot yet.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.reply({
			embeds: [successEmbed(`${emojis.rightArrow1} ${url}`)],
			flags: MessageFlags.Ephemeral,
		});
	}
}
