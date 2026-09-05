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
import { unscheduleUnban } from '#lib/banScheduler.js';
import { getBan, removeBan } from '#lib/bans.js';
import { logger } from '#lib/logger.js';
import { runConfirmedAction } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class UnbanCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('unban')
				.setDescription('Unban someone from the discord server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
				.addUserOption((option) => option.setName('member').setDescription('The member to unban').setRequired(true))
				.addStringOption((option: SlashCommandStringOption) =>
					option.setName('reason').setDescription('Provide a reason for their unban').setMaxLength(512),
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

		if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to unban members.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetMember = interaction.options.getUser('member', true);
		const reason = interaction.options.getString('reason') ?? 'No reason provided';

		const discordBan = await interaction.guild.bans.fetch(targetMember.id).catch(() => null);
		const dbBan = await getBan(interaction.guild.id, targetMember.id);

		if (!discordBan && !dbBan) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That user isn't banned.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const confirm = new ButtonBuilder().setCustomId('confirm').setLabel('Confirm Unban').setStyle(ButtonStyle.Danger);
		const cancel = new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancel, confirm);

		const response = await interaction.reply({
			embeds: [
				infoEmbed(`${emojis.rightArrow1} Are you sure you want to unban <@${targetMember.id}> for reason: ${reason}?`),
			],
			allowedMentions: { parse: [], users: [targetMember.id] },
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
						await removeBan(interaction.guild, targetMember.id);
						if (dbBan) await unscheduleUnban(dbBan.id);
						await targetMember
							.send(`You have been unbanned in **${interaction.guild.name}**.\nReason: ${reason}`)
							.catch(() => {});
					},
					{
						success: successEmbed(
							`${emojis.rightArrow2} <@${targetMember.id}> has been unbanned with reason: ${reason}`,
						),
						error: errorEmbed(`${emojis.rightArrow2} Failed to unban <@${targetMember.id}> with reason: ${reason}`),
						allowedMentions: { parse: [], users: [targetMember.id] },
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
