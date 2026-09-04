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
} from 'discord.js';
import { getWarn, removeWarn } from '#lib/warns.js';
import { runConfirmedAction } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class UnwarnCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('unwarn')
				.setDescription('Unwarn someone in the discord server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
				.addStringOption((option: SlashCommandStringOption) =>
					option.setName('id').setDescription('The ID of the warn to remove').setRequired(true).setMaxLength(36),
				)
				.addStringOption((option: SlashCommandStringOption) =>
					option.setName('reason').setDescription('Provide a reason for removing the warn').setMaxLength(512),
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
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to remove warns.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const warnId = interaction.options.getString('id', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';

		const warn = await getWarn(warnId, interaction.guild.id);

		if (!warn) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} No warn found with that ID in this server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (warn.userId === interaction.user.id) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You cannot remove your own warns.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetMember =
			interaction.guild.members.cache.get(warn.userId) ??
			(await interaction.guild.members.fetch(warn.userId).catch(() => null));

		if (targetMember) {
			if (targetMember.id === interaction.guild.ownerId) {
				await interaction.reply({
					embeds: [errorEmbed(`${emojis.rightArrow2} You cannot remove the server owner's warns.`)],
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
		}

		const confirm = new ButtonBuilder().setCustomId('confirm').setLabel('Confirm Unwarn').setStyle(ButtonStyle.Danger);
		const cancel = new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancel, confirm);

		const response = await interaction.reply({
			embeds: [
				infoEmbed(
					`${emojis.rightArrow1} Are you sure you want to unwarn <@${warn.userId}> with reason: ${reason}?\n${emojis.rightArrow2} They were warned for: ${warn.reason} <t:${Math.floor(warn.createdAt.getTime() / 1000)}:R>`,
				),
			],
			allowedMentions: { parse: [], users: [warn.userId] },
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
						await removeWarn(warn.id);
						const user = await interaction.client.users.fetch(warn.userId);
						await user
							.send(
								`Your warn for ${warn.reason} in **${interaction.guild.name}** has been removed.\nReason: ${reason}`,
							)
							.catch(() => {});
					},
					{
						success: successEmbed(
							`${emojis.rightArrow2} \`${warn.id}\` has been removed from <@${warn.userId}>. Reason: ${reason}`,
						),
						error: errorEmbed(`${emojis.rightArrow2} Failed to remove warn \`${warn.id}\` from <@${warn.userId}>.`),
						allowedMentions: { parse: [], users: [warn.userId] },
					},
					(err) => console.error(`Failed to remove warn ${warn.id}:`, err),
				);
			} else if (confirmation.customId === 'cancel') {
				await confirmation.update({
					embeds: [infoEmbed(`${emojis.rightArrow2} Cancelled.`)],
					components: [],
				});
			}
		} catch {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} No response within a minute or errored.`)],
				components: [],
			});
		}
	}
}
