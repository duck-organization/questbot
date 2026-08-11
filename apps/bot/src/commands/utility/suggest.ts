// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BucketScope, Command } from '@sapphire/framework';
import { MessageFlags, type SlashCommandStringOption } from 'discord.js';
import { errorEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class SuggestCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			preconditions: ['devMode'],
			// i forgot sapphire had a built-in cooldown! :D
			cooldownDelay: 60_000,
			cooldownLimit: 1,
			cooldownScope: BucketScope.User,
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('suggest')
				.setDescription('Suggest a feature for Quest Bot!')
				.addStringOption((option: SlashCommandStringOption) =>
					option.setName('suggestion').setDescription('This is what will be sent to us!').setRequired(true),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const webhook = process.env.SUGGESTIONS_URL ?? '';
		const message = interaction.options.getString('suggestion');
		const name = interaction.user.username;

		if (!message) {
			interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Please provide a suggestion!`)],
			});
			return;
		}

		if (!webhook) {
			interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Suggestions have not been setup yet.`)],
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const response = await fetch(webhook, {
				method: 'POST',
				body: JSON.stringify({
					userId: interaction.user.id,
					username: name,
					body: message,
				}),
				headers: {
					'Content-type': 'application/json; charset=UTF-8',
				},
			});

			if (response.ok) {
				await interaction.editReply({ embeds: [successEmbed(`${emojis.rightArrow1} Sent!`)] });
				return;
			} else {
				await interaction.editReply({
					embeds: [errorEmbed(`${emojis.rightArrow2} There was an error trying to send your suggestion!`)],
				});
				return;
			}
		} catch {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} There was an error trying to send your suggestion!`)],
			});
			return;
		}
	}
}
