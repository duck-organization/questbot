// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	MessageFlags,
	type SlashCommandStringOption,
	type SlashCommandSubcommandBuilder,
	type SlashCommandUserOption,
} from 'discord.js';
import { addConfessionBlacklist, isConfessionBlacklisted, removeConfessionBlacklist } from '#lib/confessions.js';
import { logger } from '#lib/logger.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class ConfessionBlacklistCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['globalModerator'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('confessionblacklist')
				.setDescription('Manage the confession blacklist')
				.setDefaultMemberPermissions(0)
				.setDMPermission(false)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('add')
						.setDescription('Blacklist a user from making confessions')
						.addUserOption((opt: SlashCommandUserOption) =>
							opt.setName('user').setDescription('User to blacklist').setRequired(true),
						)
						.addStringOption((opt: SlashCommandStringOption) =>
							opt.setName('reason').setDescription('Reason').setMaxLength(512).setRequired(false),
						),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('remove')
						.setDescription('Remove a user from the confession blacklist')
						.addUserOption((opt: SlashCommandUserOption) =>
							opt.setName('user').setDescription('User to unblacklist').setRequired(true),
						),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('check')
						.setDescription('Check if a user is blacklisted from confessions')
						.addUserOption((opt: SlashCommandUserOption) =>
							opt.setName('user').setDescription('User to check').setRequired(true),
						),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const subcommand = interaction.options.getSubcommand();
		const user = interaction.options.getUser('user', true);

		if (subcommand === 'add') {
			const reason = interaction.options.getString('reason') ?? undefined;
			try {
				await addConfessionBlacklist(user.id, interaction.user.id, reason);
				await interaction.reply({
					embeds: [
						successEmbed(
							`${emojis.rightArrow2} Blacklisted ${user} from confessions${reason ? ` (reason: ${reason})` : ''}.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			} catch (err) {
				logger.error(err);
				await interaction.reply({
					embeds: [errorEmbed(`${emojis.rightArrow2} Failed to blacklist that user.`)],
					flags: MessageFlags.Ephemeral,
				});
			}
		}

		if (subcommand === 'remove') {
			await removeConfessionBlacklist(user.id);
			await interaction.reply({
				embeds: [successEmbed(`${emojis.rightArrow2} Removed ${user} from the confession blacklist.`)],
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'check') {
			const blacklisted = await isConfessionBlacklisted(user.id);
			await interaction.reply({
				embeds: [
					infoEmbed(
						blacklisted
							? `${emojis.rightArrow2} ${user} is blacklisted from confessions.`
							: `${emojis.rightArrow2} ${user} is not blacklisted.`,
					),
				],
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
