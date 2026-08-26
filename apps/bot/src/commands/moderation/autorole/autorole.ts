// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	PermissionFlagsBits,
	type SlashCommandBooleanOption,
	type SlashCommandRoleOption,
	type SlashCommandStringOption,
	type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { createAutoRole, getAutoRole, getAutoRoles, removeAutoRole } from '#lib/autorole.js';
import { LimitError } from '#lib/limits.js';
import { awaitMessageComponentSafe } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class AutoRoleCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('autorole')
				.setDescription('Automatically assign roles to new members!')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('add')
						.setDescription('Create a new auto role.')
						.addRoleOption((option: SlashCommandRoleOption) =>
							option.setName('role').setDescription('The role to assign to new members').setRequired(true),
						)
						.addBooleanOption((option: SlashCommandBooleanOption) =>
							option
								.setName('bot_role')
								.setDescription('Whether this role should be assigned to bots')
								.setRequired(true),
						),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('remove')
						.setDescription('Remove an auto role.')
						.addStringOption((option: SlashCommandStringOption) =>
							option
								.setName('role')
								.setDescription('The auto role to remove')
								.setAutocomplete(true)
								.setRequired(true)
								.setMaxLength(36),
						),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand.setName('list').setDescription('List all auto roles.'),
				),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		if (!interaction.guildId) {
			await interaction.respond([]);
			return;
		}

		const focusedOption = interaction.options.getFocused(true);

		if (interaction.options.getSubcommand() !== 'remove' || focusedOption.name !== 'role') {
			await interaction.respond([]);
			return;
		}

		const query = focusedOption.value.toString().trim().toLowerCase();
		const autoRoles = await getAutoRoles(interaction.guildId);
		const named = autoRoles.map((autoRole) => ({
			autoRole,
			name: interaction.guild?.roles.cache.get(autoRole.roleId)?.name ?? autoRole.roleId,
		}));
		const matches = query ? named.filter(({ name }) => name.toLowerCase().includes(query)) : named;

		const choices = matches.slice(0, 25).map(({ autoRole, name }) => ({
			name,
			value: autoRole.id,
		}));

		await interaction.respond(choices);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} This command can only be used in a server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'add') {
			const role = interaction.options.getRole('role', true);
			const botRole = interaction.options.getBoolean('bot_role', true);

			if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
				await interaction.reply({
					embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to configure auto roles.`)],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (interaction.member.roles.highest.position <= role.position) {
				await interaction.reply({
					embeds: [
						errorEmbed(`${emojis.rightArrow2} You can only configure auto roles for roles below your highest role.`),
					],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			try {
				await createAutoRole(interaction.guildId, interaction.guild.name, role.id, botRole);
				await interaction.reply({
					embeds: [successEmbed(`${emojis.rightArrow2} Added auto role ${role} (Bot Role: ${botRole}).`)],
					flags: MessageFlags.Ephemeral,
				});
			} catch (err) {
				if (err instanceof LimitError) {
					await interaction.reply({
						embeds: [errorEmbed(`${emojis.rightArrow2} ${err.message}`)],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				console.error(err);

				await interaction.reply({
					embeds: [errorEmbed(`${emojis.rightArrow2} That role is already an auto role in this server.`)],
					flags: MessageFlags.Ephemeral,
				});
			}
		}

		if (subcommand === 'remove') {
			const autoRoleId = interaction.options.getString('role', true);
			const autoRole = await getAutoRole(autoRoleId);

			if (!autoRole || autoRole.guildId !== interaction.guildId) {
				await interaction.reply({
					embeds: [errorEmbed(`${emojis.rightArrow2} That auto role no longer exists.`)],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			await removeAutoRole(autoRole.id);
			await interaction.reply({
				embeds: [successEmbed(`${emojis.rightArrow2} Removed auto role for <@&${autoRole.roleId}>.`)],
				flags: MessageFlags.Ephemeral,
			});
		}

		if (subcommand === 'list') {
			const autoRoles = await getAutoRoles(interaction.guildId);
			if (autoRoles.length === 0) {
				await interaction.reply({
					embeds: [infoEmbed(`${emojis.rightArrow2} There are no auto roles set up in this server.`)],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const totalPages = Math.ceil(autoRoles.length / 10);
			let page = 0;

			const buildEmbed = (page: number) => {
				const slice = autoRoles.slice(page * 10, (page + 1) * 10);
				const roleList = slice
					.map((autoRole) => {
						const role = interaction.guild?.roles.cache.get(autoRole.roleId);
						const roleName = role ? `<@&${role.id}>` : `Unknown Role (${autoRole.roleId})`;
						const botRoleText = autoRole.botRole ? ' (Bot Role)' : '';
						return `${emojis.rightArrow1} ${roleName}${botRoleText}`;
					})
					.join('\n');
				return infoEmbed(`**Auto Roles** (Page ${page + 1}/${totalPages}):\n${roleList}`);
			};

			const buildRow = (page: number) =>
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId('prev')
						.setLabel('<')
						.setStyle(ButtonStyle.Primary)
						.setDisabled(page === 0),
					new ButtonBuilder()
						.setCustomId('next')
						.setLabel('>')
						.setStyle(ButtonStyle.Primary)
						.setDisabled(page >= totalPages - 1),
				);

			if (totalPages === 1) {
				await interaction.reply({
					embeds: [buildEmbed(0)],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const response = await interaction.reply({
				embeds: [buildEmbed(page)],
				components: [buildRow(page)],
				flags: MessageFlags.Ephemeral,
				withResponse: true,
			});

			const collectorFilter = (i: { user: { id: string } }) => i.user.id === interaction.user.id;

			while (true) {
				const btn = await awaitMessageComponentSafe(response.resource!.message!, {
					filter: collectorFilter,
					time: 60_000,
				});

				if (!btn) {
					await interaction.editReply({ components: [] });
					break;
				}

				if (btn.customId === 'prev') page = Math.max(0, page - 1);
				if (btn.customId === 'next') page = Math.min(totalPages - 1, page + 1);

				await btn.update({
					embeds: [buildEmbed(page)],
					components: [buildRow(page)],
				});
			}
		}
	}
}
