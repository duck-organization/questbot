// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
	type SlashCommandStringOption,
	type SlashCommandUserOption,
} from 'discord.js';
import ms, { type StringValue } from 'ms';
import { logger } from '#lib/logger.js';
import { createMute, enforceMute } from '#lib/mutes.js';
import { runConfirmedAction } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class MuteCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('mute')
				.setDescription('Mute someone in the discord server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
				.addUserOption((option: SlashCommandUserOption) =>
					option.setName('member').setDescription('Select a member to mute').setRequired(true),
				)
				.addStringOption((option: SlashCommandStringOption) =>
					option
						.setName('duration')
						.setDescription('Specify a duration for the mute')
						.setRequired(true)
						.setMaxLength(20),
				)
				.addStringOption((option: SlashCommandStringOption) =>
					option.setName('reason').setDescription('Provide a reason for their mute').setMaxLength(512),
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

		const member = interaction.member as GuildMember;

		if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to mute members.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetMember = interaction.options.getMember('member') as GuildMember;
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const durationStr = interaction.options.getString('duration', true) as StringValue;
		const duration = ms(durationStr);

		if (!targetMember) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That user is not in this server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Invalid duration format.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const max = ms('180d');
		if (duration > max) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Mute duration cannot exceed 180 days.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const expiresAt = new Date(Date.now() + duration);

		if (targetMember.id === interaction.user.id) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot mute yourself.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (targetMember.id === interaction.guild.ownerId) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot mute the server owner.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (member.roles.highest.position <= targetMember.roles.highest.position) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot moderate someone with a higher or equal role.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!targetMember.moderatable) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} I cannot mute this user.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const confirm = new ButtonBuilder().setCustomId('confirm').setLabel('Confirm Mute').setStyle(ButtonStyle.Danger);
		const cancel = new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancel, confirm);

		const response = await interaction.reply({
			embeds: [
				infoEmbed(
					`${emojis.rightArrow1} Are you sure you want to mute <@${targetMember.user.id}> with reason: ${reason}?`,
				),
			],
			allowedMentions: { parse: [], users: [targetMember.user.id] },
			components: [row],
			withResponse: true,
		});

		const collectorFilter = (i: { user: { id: string } }) => i.user.id === interaction.user.id;

		try {
			const confirmation = await import('#utils/collectors.js').then((m) =>
				m.awaitMessageComponentSafe(response.resource!.message!, { filter: collectorFilter, time: 60_000 }),
			);

			if (!confirmation) {
				await interaction.editReply({
					embeds: [errorEmbed(`${emojis.rightArrow2} No response within a minute or errored.`)],
					components: [],
				});
				return;
			}

			if (confirmation.customId === 'confirm') {
				await runConfirmedAction(
					confirmation,
					interaction,
					async () => {
						await createMute(interaction.guild.id, interaction.guild.name, targetMember.id, expiresAt, reason);

						await targetMember
							.send(
								`You have been muted in **${interaction.guild.name}**.\nReason: ${reason}${
									expiresAt ? `\nExpires: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : ''
								}`,
							)
							.catch(() => {});

						await enforceMute(interaction.guild, targetMember.id);
					},
					{
						success: successEmbed(
							`${emojis.rightArrow2} <@${targetMember.user.id}> has been muted with reason: ${reason}${
								expiresAt ? `\nExpires: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : ''
							}`,
						),
						error: errorEmbed(`${emojis.rightArrow2} Failed to mute <@${targetMember.user.id}> with reason: ${reason}`),
						allowedMentions: { parse: [], users: [targetMember.user.id] },
					},
				);
			} else if (confirmation.customId === 'cancel') {
				await confirmation.update({
					embeds: [infoEmbed(`${emojis.rightArrow2} Cancelled.`)],
					components: [],
				});
			}
		} catch (err) {
			logger.error(err);
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} No response within a minute or errored.`)],
				components: [],
			});
		}
	}
}
