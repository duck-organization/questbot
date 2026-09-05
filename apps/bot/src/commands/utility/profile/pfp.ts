// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import type { SlashCommandBooleanOption, SlashCommandUserOption } from 'discord.js';
import { ASSET_SIZE, assetMessage } from '#utils/profile.js';

export class PfpCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('pfp')
				.setDescription("Easily download or view your own or someone else's pfp.")
				.addUserOption((option: SlashCommandUserOption) =>
					option.setName('user').setDescription('The user whose profile picture you want to view').setRequired(false),
				)
				.addBooleanOption((option: SlashCommandBooleanOption) =>
					option
						.setName('global')
						.setDescription('Whether to view the global version of the profile picture')
						.setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();

		const user = interaction.options.getUser('user') ?? interaction.user;
		const global = interaction.options.getBoolean('global') ?? false;

		const member =
			!global && interaction.inCachedGuild() ? (interaction.options.getMember('user') ?? interaction.member) : null;

		// todo: in the future size could become an option rather than 4096 hard coded
		const avatarUrl = (member ?? user).displayAvatarURL({ size: ASSET_SIZE });

		await interaction.editReply(assetMessage(user.displayName, user.id, avatarUrl));
	}
}
