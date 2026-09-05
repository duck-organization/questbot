// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags, type SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { Colors, errorEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';
import { ASSET_SIZE, replyWithAsset, toUnix } from '#utils/profile.js';

export class ServerCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder: SlashCommandBuilder) =>
			builder
				.setName('server')
				.setDescription("View the server's icon, banner, or info.")
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand.setName('icon').setDescription("Easily download or view the server's icon."),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand.setName('banner').setDescription("Easily download or view the server's banner."),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand.setName('info').setDescription('View information about this server.'),
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

		await interaction.deferReply();

		const guild = interaction.guild;
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'icon') {
			await replyWithAsset(
				interaction,
				guild.name,
				guild.id,
				guild.iconURL({ size: ASSET_SIZE }),
				`**${guild.name}** doesn't have an icon!`,
			);
			return;
		}

		if (subcommand === 'banner') {
			await replyWithAsset(
				interaction,
				guild.name,
				guild.id,
				guild.bannerURL({ size: ASSET_SIZE }),
				`**${guild.name}** doesn't have a banner!`,
			);
			return;
		}

		if (subcommand === 'info') {
			const created = toUnix(guild.createdTimestamp);
			const lines = [
				`${emojis.rightArrow1} **Owner:** <@${guild.ownerId}>`,
				`${emojis.rightArrow1} **Created:** <t:${created}:D> (<t:${created}:R>)`,
				`${emojis.rightArrow1} **Members:** ${guild.memberCount}`,
				`${emojis.rightArrow1} **Boosts:** ${guild.premiumSubscriptionCount ?? 0} (Level ${guild.premiumTier})`,
			];

			const embed = new EmbedBuilder()
				.setColor(Colors.info)
				.setTitle(guild.name)
				.setThumbnail(guild.iconURL({ size: ASSET_SIZE }))
				.setDescription(lines.join('\n'))
				.setFooter({ text: `ID: ${guild.id}` });

			await interaction.editReply({ embeds: [embed] });
		}
	}
}
