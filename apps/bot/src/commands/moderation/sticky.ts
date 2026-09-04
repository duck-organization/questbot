// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	EmbedBuilder,
	type GuildTextBasedChannel,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
	type SlashCommandStringOption,
	type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { containsBlockedWord } from '#lib/automod.js';
import { logger } from '#lib/logger.js';
import { logEmbed, truncate } from '#lib/logging.js';
import { getSticky, removeSticky, repostSticky, setSticky } from '#lib/sticky.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class StickyCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('sticky')
				.setDescription('Pin a message to the bottom of this channel.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('set')
						.setDescription('Set the sticky message for this channel')
						.addStringOption((option: SlashCommandStringOption) =>
							option
								.setName('message')
								.setDescription('The message to pin at the bottom of this channel')
								.setRequired(true)
								.setMaxLength(300),
						),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand.setName('remove').setDescription('Remove the sticky message from this channel'),
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

		const channel = interaction.channel;

		if (!channel?.isTextBased()) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} This channel cannot have a sticky message.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!channel.permissionsFor(interaction.member)?.has(PermissionsBitField.Flags.ManageChannels)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to manage this channel.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (interaction.options.getSubcommand() === 'set') {
			await this.set(interaction, channel);
			return;
		}

		await this.remove(interaction, channel);
	}

	private async set(interaction: Command.ChatInputCommandInteraction<'cached'>, channel: GuildTextBasedChannel) {
		const me = interaction.guild.members.me;

		if (!me || !channel.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} I cannot send messages here.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const content = interaction.options.getString('message', true).trim();

		if (!content) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} The sticky message cannot be empty.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (await containsBlockedWord(interaction.guildId, content)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That message contains a word blocked by this server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			const sticky = await setSticky(interaction.guildId, interaction.guild.name, channel.id, content);
			await repostSticky(channel, sticky, true);

			const logEntry = new EmbedBuilder()
				.setTitle('Sticky Message Set')
				.setColor(0x77dd76)
				.addFields(
					{ name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
					{ name: 'Channel', value: channel.toString(), inline: true },
					{ name: 'Message', value: truncate(content) || '-', inline: false }, // if this actually shows up as '-' then my security researcher would probably kill me and send me questbot's gh advisories
				)
				.setTimestamp();

			await logEmbed(interaction.guild, logEntry);

			await interaction.reply({
				embeds: [successEmbed(`${emojis.rightArrow1} Sticky message set for this channel.`)],
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			logger.error(error);
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Failed to set the sticky message for this channel.`)],
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async remove(interaction: Command.ChatInputCommandInteraction<'cached'>, channel: GuildTextBasedChannel) {
		try {
			const sticky = await getSticky(interaction.guildId, channel.id);
			const removed = await removeSticky(interaction.guildId, channel.id);

			if (!removed) {
				await interaction.reply({
					embeds: [infoEmbed(`${emojis.rightArrow2} There is no sticky message in this channel.`)],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (sticky?.stickyMessageId) {
				await channel.messages.delete(sticky.stickyMessageId).catch(() => {});
			}

			const logEntry = new EmbedBuilder()
				.setTitle('Sticky Message Removed')
				.setColor(0xff6962)
				.addFields(
					{ name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
					{ name: 'Channel', value: channel.toString(), inline: true },
					{ name: 'Message', value: truncate(sticky?.stickyContent) || '-', inline: false },
				)
				.setTimestamp();

			await logEmbed(interaction.guild, logEntry);

			await interaction.reply({
				embeds: [successEmbed(`${emojis.rightArrow1} Sticky message removed from this channel.`)],
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			logger.error(error);
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Failed to remove the sticky message from this channel.`)],
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
