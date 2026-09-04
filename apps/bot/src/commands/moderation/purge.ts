// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { logger } from '#lib/logger.js';
import { logEmbed } from '#lib/logging.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class PurgeCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('purge')
				.setDescription('Purge messages up to 14d old from a channel.')
				.addIntegerOption((option) =>
					option
						.setName('amount')
						.setDescription('The number of messages to purge')
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(1000),
				)
				.addBooleanOption((option) =>
					option.setName('images').setDescription('Set to true to only purge messages with images.').setRequired(false),
				)
				.addBooleanOption((option) =>
					option.setName('bots').setDescription('Set to true to only purge messages from bots.').setRequired(false),
				)
				.addBooleanOption((option) =>
					option.setName('users').setDescription('Set to true to only purge messages from users.').setRequired(false),
				)
				.addUserOption((option) =>
					option.setName('user').setDescription('The user whose messages to purge.').setRequired(false),
				)
				.addRoleOption((option) =>
					option.setName('role').setDescription('The role whose messages to purge.').setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} This command can only be used in a server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const member = interaction.member;
		const channel = interaction.channel;

		if (!channel || !('messages' in channel)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Unable to access channel messages.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (
			!member ||
			!('permissions' in member) ||
			!channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ManageMessages)
		) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to manage messages.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const amount = interaction.options.getInteger('amount', true);
		const images = interaction.options.getBoolean('images') ?? false;
		const bots = interaction.options.getBoolean('bots') ?? false;
		const users = interaction.options.getBoolean('users') ?? false;
		const user = interaction.options.getUser('user');
		const role = interaction.options.getRole('role');

		if (bots && users) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} The bots and users filters be enabled simultaneously.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await interaction.editReply({ embeds: [infoEmbed(`${emojis.rightArrow2} Purging ${amount} messages...`)] });

		try {
			let deletedCount = 0;
			let before: string | undefined;

			while (deletedCount < amount) {
				const messages = await channel.messages.fetch({
					limit: 100,
					...(before && { before }),
				});

				if (messages.size === 0) break;

				before = messages.last()?.id;
				const matches = messages
					.filter(
						(message) =>
							(!images || message.attachments.some((attachment) => attachment.contentType?.startsWith('image/'))) &&
							(!bots || message.author.bot) &&
							(!users || !message.author.bot) &&
							(!user || message.author.id === user.id) &&
							(!role || message.member?.roles.cache.has(role.id) === true),
					)
					.first(amount - deletedCount);

				if (matches.length > 0) {
					const deleted = await channel.bulkDelete(matches, true);
					deletedCount += deleted.size;

					await interaction.editReply({
						embeds: [infoEmbed(`${emojis.rightArrow2} Purged ${deletedCount}/${amount} messages...`)],
					});

					if (deleted.size < matches.length) break;
				}

				if (messages.size < 100) break;
			}

			const logEntry = new EmbedBuilder()
				.setTitle('Purged')
				.setColor(0xff6962)
				.addFields(
					{ name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
					{ name: 'Channel', value: channel.toString(), inline: true },
					{ name: 'Count', value: `${deletedCount}`, inline: true },
				)
				.setTimestamp();

			await logEmbed(interaction.guild, logEntry);

			await interaction.editReply({
				embeds: [successEmbed(`${emojis.rightArrow1} Successfully purged ${deletedCount} messages.`)],
			});
		} catch (err) {
			logger.error(err);
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} An error occurred while trying to purge messages.`)],
			});
		}
	}
}
