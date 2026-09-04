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
import { runConfirmedAction } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class KickCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('kick')
				.setDescription('Kick someone from the discord server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
				.addUserOption((option: SlashCommandUserOption) =>
					option.setName('member').setDescription('Select a member to kick').setRequired(true),
				)
				.addStringOption((option: SlashCommandStringOption) =>
					option.setName('reason').setDescription('Provide a reason for their kick').setMaxLength(512),
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

		if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to kick members.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetMember = interaction.options.getMember('member');
		const reason = interaction.options.getString('reason') ?? 'No reason provided';

		if (!targetMember) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That user is not in this server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (targetMember.id === interaction.user.id) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot kick yourself.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (targetMember.id === interaction.guild.ownerId) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot kick the server owner.`)],
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

		if (!targetMember.kickable) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} I cannot kick this user.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const confirm = new ButtonBuilder().setCustomId('confirm').setLabel('Confirm Kick').setStyle(ButtonStyle.Danger);
		const cancel = new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancel, confirm);

		const response = await interaction.reply({
			embeds: [
				infoEmbed(
					`${emojis.rightArrow1} Are you sure you want to kick <@${targetMember.user.id}> with reason: ${reason}?`,
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
						await interaction.guild.members.kick(targetMember);
						await targetMember
							.send(`You have been kicked from **${interaction.guild.name}**.\nReason: ${reason}`)
							.catch(() => {});
					},
					{
						success: successEmbed(
							`${emojis.rightArrow2} <@${targetMember.user.id}> has been kicked with reason: ${reason}\nYou must have had a real ick towards that person.`,
						),
						error: errorEmbed(
							`${emojis.rightArrow2} Failed to kick <@${targetMember.user.id}> with reason: ${reason}\nYou must have had a real ick towards that person.`,
						),
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
			console.error(err);
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} No response within a minute or errored.`)],
				components: [],
			});
		}
	}
}
