// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isChannelLocked, isChannelLockedDown, unlockChannel } from '#lib/lockdown.js';
import { logger } from '#lib/logger.js';
import { logEmbed } from '#lib/logging.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class UnlockCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('unlock')
				.setDescription('Unlock the current channel.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
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

		const channel = interaction.channel;

		if (!channel || channel.isThread() || !('permissionOverwrites' in channel)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} This channel cannot be unlocked.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to unlock this channel.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (await isChannelLockedDown(channel.id)) {
			await interaction.reply({
				embeds: [
					infoEmbed(
						`${emojis.rightArrow2} This channel is locked by the server wide lockdown. Use \`/unlockdown\` instead.`,
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!(await isChannelLocked(channel.id))) {
			await interaction.reply({
				embeds: [infoEmbed(`${emojis.rightArrow2} This channel is not locked.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const unlocked = await unlockChannel(channel, `Unlocked by ${interaction.user.tag}`);

			if (!unlocked) {
				await interaction.editReply({
					embeds: [errorEmbed(`${emojis.rightArrow2} Failed to unlock this channel.`)],
				});
				return;
			}

			const logEntry = new EmbedBuilder()
				.setTitle('Channel Unlocked')
				.setColor(0x77dd76)
				.addFields(
					{ name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
					{ name: 'Channel', value: `<#${channel.id}>`, inline: true },
				)
				.setTimestamp();

			await logEmbed(interaction.guild, logEntry);

			await interaction.editReply({ embeds: [successEmbed(`${emojis.rightArrow1} Channel unlocked.`)] });
		} catch (error) {
			logger.error(error);
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Failed to unlock this channel.`)],
			});
		}
	}
}
