// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
} from 'discord.js';
import ms, { type StringValue } from 'ms';
import { logEmbed, truncate } from '#lib/logging.js';
import { createWarn } from '#lib/warns.js';
import { runConfirmedAction } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class WarnCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('warn')
				.setDescription('Warn someone in the discord server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
				.addUserOption((option) => option.setName('member').setDescription('Select a member to warn').setRequired(true))
				.addStringOption((option) =>
					option.setName('reason').setDescription('Provide a reason for their warn').setMaxLength(512),
				)
				.addStringOption((option) =>
					option.setName('duration').setDescription('Specify a duration for the warn').setMaxLength(20),
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
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to warn members.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetMember = interaction.options.getMember('member') as GuildMember;
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const durationStr = interaction.options.getString('duration') as StringValue;
		const duration = durationStr ? ms(durationStr) : null;
		const expiresAt = duration ? new Date(Date.now() + duration) : null;

		if (durationStr && (typeof duration !== 'number' || Number.isNaN(duration))) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Invalid duration format.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!targetMember) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That user is not in this server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (targetMember.id === interaction.user.id) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot warn yourself.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (targetMember.id === interaction.guild.ownerId) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot warn the server owner.`)],
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
				embeds: [errorEmbed(`${emojis.rightArrow2} I cannot warn this user.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const confirm = new ButtonBuilder().setCustomId('confirm').setLabel('Confirm Warn').setStyle(ButtonStyle.Danger);
		const cancel = new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancel, confirm);

		const response = await interaction.reply({
			embeds: [
				infoEmbed(
					`${emojis.rightArrow1} Are you sure you want to warn <@${targetMember.user.id}> with reason: ${reason}?`,
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
						await createWarn(
							interaction.guild.id,
							interaction.guild.name,
							targetMember.id,
							interaction.user.id,
							reason,
							expiresAt,
						);
						await targetMember
							.send(
								`You have been warned in **${interaction.guild.name}**.\nReason: ${reason}${expiresAt ? `\nExpires: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : ''}`,
							)
							.catch(() => {});

						const logEntry = new EmbedBuilder()
							.setTitle('Member Warned')
							.setColor(0xfac898)
							.addFields(
								{ name: 'Member', value: `<@${targetMember.id}>`, inline: true },
								{ name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
								{ name: 'Reason', value: truncate(reason) || '-', inline: false },
							)
							.setTimestamp();

						if (expiresAt) {
							logEntry.addFields({
								name: 'Expires',
								value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
								inline: true,
							});
						}

						await logEmbed(interaction.guild, logEntry);
					},
					{
						success: successEmbed(`${emojis.rightArrow2} <@${targetMember.id}> has been warned with reason: ${reason}`),
						error: errorEmbed(`${emojis.rightArrow2} Failed to warn <@${targetMember.id}>`),
						allowedMentions: { parse: [], users: [targetMember.user.id] },
					},
				);
			} else if (confirmation.customId === 'cancel') {
				await confirmation.update({ embeds: [infoEmbed(`${emojis.rightArrow2} Cancelled.`)], components: [] });
			}
		} catch (err) {
			console.error(err);
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} No response within a minute or errored.`)],
				components: [],
			});
		}
	}
}
