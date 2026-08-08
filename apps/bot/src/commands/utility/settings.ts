// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ChannelType,
	type Guild,
	InteractionContextType,
	LabelBuilder,
	type MessageComponentInteraction,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	RoleSelectMenuBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { createHoneypot, deleteHoneypot } from '#lib/honeypot.js';
import { logSettingsChange } from '#lib/logging.js';
import { SCAM_ACTIONS, type ScamAction } from '#lib/scamProtection.js';
import { getSettings, type ServerSettings, updateSettings } from '#lib/settings.js';
import { errorEmbed, infoEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

const STALE_INTERACTION_ERROR_CODES = new Set([10_015, 50_027, 10062]);

function isStaleInteractionError(error: unknown): error is { code: number } {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'number' &&
		STALE_INTERACTION_ERROR_CODES.has(error.code)
	);
}

function buildWelcomePanel(settings: ServerSettings, guild: Guild, status?: string) {
	const currentChannelName = settings.welcomeChannelId
		? guild.channels.cache.get(settings.welcomeChannelId)?.name
		: null;

	const toggleMenu = new StringSelectMenuBuilder()
		.setCustomId('welcomeToggle')
		.setPlaceholder(`${settings.welcomePeople ? 'Enabled' : 'Disabled'}`)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('Enable')
				.setDescription('Send a message when a user joins the server.')
				.setValue('enable'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Disable')
				.setDescription("Don't send a message when a user joins the server.")
				.setValue('disable'),
		);

	const channelMenu = new ChannelSelectMenuBuilder()
		.setCustomId('welcomeChannel')
		.setPlaceholder(currentChannelName ? `#${currentChannelName}` : 'Select a channel for welcome messages')
		.setChannelTypes(ChannelType.GuildText);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Welcome** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Welcome** module:`,
			),
		],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleMenu),
			new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelMenu),
		],
	};
}

function buildTicketPanel(settings: ServerSettings, guild: Guild, status?: string) {
	const currentCategoryName = settings.ticketCategoryId
		? guild.channels.cache.get(settings.ticketCategoryId)?.name
		: null;

	const categoryMenu = new ChannelSelectMenuBuilder()
		.setCustomId('ticketCategory')
		.setPlaceholder(currentCategoryName ?? 'Select a category for tickets')
		.setChannelTypes(ChannelType.GuildCategory);

	const removeButton = new ButtonBuilder()
		.setCustomId('ticketCategoryRemove')
		.setLabel('Remove Category')
		.setStyle(ButtonStyle.Danger)
		.setDisabled(!settings.ticketCategoryId);

	const currentStaffRole = settings.staffRole ? guild.roles.cache.get(settings.staffRole)?.name : null;

	const staffRole = new RoleSelectMenuBuilder()
		.setCustomId('staffRole')
		.setPlaceholder(currentStaffRole ?? 'Select a ticket staff role');

	const removeStaffRoleButton = new ButtonBuilder()
		.setCustomId('removeStaffRole')
		.setLabel('Remove Staff Role')
		.setStyle(ButtonStyle.Danger)
		.setDisabled(!settings.staffRole);

	const currentTranscriptChannelName = settings.ticketTranscriptChannelId
		? guild.channels.cache.get(settings.ticketTranscriptChannelId)?.name
		: null;

	const ticketTranscriptChannel = new ChannelSelectMenuBuilder()
		.setCustomId('ticketTranscriptChannel')
		.setPlaceholder(
			currentTranscriptChannelName ? `#${currentTranscriptChannelName}` : 'Select a channel for ticket transcripts',
		)
		.setChannelTypes(ChannelType.GuildText);

	const removeTranscriptChannelButton = new ButtonBuilder()
		.setCustomId('removeTranscriptChannel')
		.setLabel('Remove Transcript Channel')
		.setStyle(ButtonStyle.Danger)
		.setDisabled(!settings.ticketTranscriptChannelId);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Tickets** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Tickets** module:`,
			),
		],
		components: [
			new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(categoryMenu),
			new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(staffRole),
			new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ticketTranscriptChannel),
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				removeButton,
				removeStaffRoleButton,
				removeTranscriptChannelButton,
			),
		],
	};
}

function buildLoggingPanel(settings: ServerSettings, guild: Guild, status?: string) {
	const currentChannelName = settings.loggingChannelId
		? guild.channels.cache.get(settings.loggingChannelId)?.name
		: null;

	const toggleMenu = new StringSelectMenuBuilder()
		.setCustomId('loggingToggle')
		.setPlaceholder(`${settings.loggingEnabled ? 'Enabled' : 'Disabled'}`)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('Enable')
				.setDescription('Log all server events.')
				.setValue('enable'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Disable')
				.setDescription("Don't log any server events.")
				.setValue('disable'),
		);

	const channelMenu = new ChannelSelectMenuBuilder()
		.setCustomId('loggingChannel')
		.setPlaceholder(currentChannelName ? `#${currentChannelName}` : 'Select a channel for logging messages')
		.setChannelTypes(ChannelType.GuildText);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Logging** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Logging** module:`,
			),
		],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleMenu),
			new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelMenu),
		],
	};
}

function buildConfessionPanel(settings: ServerSettings, guild: Guild, status?: string) {
	const currentChannelName = settings.confessionChannelId
		? guild.channels.cache.get(settings.confessionChannelId)?.name
		: null;

	const toggleMenu = new StringSelectMenuBuilder()
		.setCustomId('confessionToggle')
		.setPlaceholder(`${settings.confessionEnabled ? 'Enabled' : 'Disabled'}`)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('Enable')
				.setDescription('Enable confessions for this server.')
				.setValue('enable'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Disable')
				.setDescription('Disable confessions for this server.')
				.setValue('disable'),
		);

	const channelMenu = new ChannelSelectMenuBuilder()
		.setCustomId('confessionChannel')
		.setPlaceholder(currentChannelName ? `#${currentChannelName}` : 'Select a channel for confessions')
		.setChannelTypes(ChannelType.GuildText);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Confessions** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Confessions** module:`,
			),
		],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleMenu),
			new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelMenu),
		],
	};
}

function buildHaikuPanel(settings: ServerSettings, status?: string) {
	const toggleMenu = new StringSelectMenuBuilder()
		.setCustomId('haikuToggle')
		.setPlaceholder(`${settings.haikuEnabled ? 'Enabled' : 'Disabled'}`)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('Enable')
				.setDescription('Reply when a message forms a haiku.')
				.setValue('enable'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Disable')
				.setDescription("Don't detect haikus.")
				.setValue('disable'),
		);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Haiku** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Haiku** module:`,
			),
		],
		components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleMenu)],
	};
}

function buildAutoPublisherPanel(settings: ServerSettings, status?: string) {
	const toggleMenu = new StringSelectMenuBuilder()
		.setCustomId('autoPublisherToggle')
		.setPlaceholder(`${settings.autoPublisher ? 'Enabled' : 'Disabled'}`)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('Enable')
				.setDescription('Automatically publish messages posted in announcement channels.')
				.setValue('enable'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Disable')
				.setDescription("Don't publish announcements automatically.")
				.setValue('disable'),
		);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Auto Publisher** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Auto Publisher** module:\n${emojis.rightArrow2} Warning! I need **Manage Messages** (in your announcement channels) to publish other people's messages.`,
			),
		],
		components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleMenu)],
	};
}

function buildStarboardPanel(settings: ServerSettings, guild: Guild, status?: string) {
	const currentChannelName = settings.starboardChannelId
		? guild.channels.cache.get(settings.starboardChannelId)?.name
		: null;

	const toggleMenu = new StringSelectMenuBuilder()
		.setCustomId('starboardToggle')
		.setPlaceholder(`${settings.starboardEnable ? 'Enabled' : 'Disabled'}`)
		.addOptions(
			new StringSelectMenuOptionBuilder().setLabel('Enable').setDescription('Enable the starboard.').setValue('enable'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Disable')
				.setDescription('Disable the starboard.')
				.setValue('disable'),
		);

	const channelMenu = new ChannelSelectMenuBuilder()
		.setCustomId('starboardChannel')
		.setPlaceholder(currentChannelName ? `#${currentChannelName}` : 'Select a channel for starred messages')
		.setChannelTypes(ChannelType.GuildText);

	const countButton = new ButtonBuilder()
		.setCustomId('starboardCount')
		.setLabel(`Configure Reaction Count`)
		.setStyle(ButtonStyle.Secondary);

	const emojiButton = new ButtonBuilder()
		.setCustomId('starboardEmoji')
		.setLabel(`Configure Emoji`)
		.setStyle(ButtonStyle.Secondary);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Starboard** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Starboard** module:`,
			),
		],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleMenu),
			new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelMenu),
			new ActionRowBuilder<ButtonBuilder>().addComponents(countButton, emojiButton),
		],
	};
}

function buildScamProtectionPanel(settings: ServerSettings, guild: Guild, status?: string) {
	const toggleMenu = new StringSelectMenuBuilder()
		.setCustomId('scamProtectionToggle')
		.setPlaceholder(`${settings.scamProtectionEnabled ? 'Enabled' : 'Disabled'}`)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('Enable')
				.setDescription('Act on members spamming across channels.')
				.setValue('enable'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Disable')
				.setDescription("Don't watch for spam.")
				.setValue('disable'),
		);

	const actionMenu = new StringSelectMenuBuilder()
		.setCustomId('scamProtectionAction')
		.setPlaceholder(SCAM_ACTIONS[settings.scamProtectionAction])
		.addOptions(
			Object.entries(SCAM_ACTIONS).map(([action, label]) =>
				new StringSelectMenuOptionBuilder().setLabel(label).setValue(action),
			),
		);

	const currentExemptionRole = settings.scamProtectionExemptionRole
		? guild.roles.cache.get(settings.scamProtectionExemptionRole)?.name
		: null;

	const exemptionRole = new RoleSelectMenuBuilder()
		.setCustomId('exemptionRole')
		.setPlaceholder(currentExemptionRole ?? 'Select a role that bypasses scam protection');

	const removeExemptionRoleButton = new ButtonBuilder()
		.setCustomId('removeExemptionRole')
		.setLabel('Remove Exemption Role')
		.setStyle(ButtonStyle.Danger)
		.setDisabled(!settings.scamProtectionExemptionRole);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Scam Protection** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Scam Protection** module:\n${emojis.rightArrow2} Warning! Please make sure I at least have **Manage Messages** (and *Kick Members* or *Ban Members* for those actions).`,
			),
		],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleMenu),
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(actionMenu),
			new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(exemptionRole),
			new ActionRowBuilder<ButtonBuilder>().addComponents(removeExemptionRoleButton),
		],
	};
}

function buildHoneypotPanel(settings: ServerSettings, status?: string) {
	const createButton = new ButtonBuilder()
		.setCustomId('honeypotCreate')
		.setLabel('Create')
		.setStyle(ButtonStyle.Secondary)
		.setDisabled(Boolean(settings.honeypotChannelId));

	const deleteButton = new ButtonBuilder()
		.setCustomId('honeypotDelete')
		.setLabel('Delete')
		.setStyle(ButtonStyle.Danger)
		.setDisabled(!settings.honeypotChannelId);

	return {
		embeds: [
			infoEmbed(
				status
					? `${emojis.rightArrow1} **Honey Pot** module:\n${emojis.rightArrow2} ${status}`
					: `${emojis.rightArrow1} **Honey Pot** module:\nThe channel catches spammers while it exists, so deleting it turns the module off.\n${emojis.rightArrow2} Warning! Please make sure I have **Manage Channels**, **Manage Messages** and **Kick Members**.`,
			),
		],
		components: [new ActionRowBuilder<ButtonBuilder>().addComponents(createButton, deleteButton)],
	};
}

async function promptForValue(
	button: ButtonInteraction,
	name: string,
	title: string,
	label: string,
	input: TextInputBuilder,
) {
	await button.showModal(
		new ModalBuilder()
			.setCustomId(name)
			.setTitle(title)
			.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input)),
	);

	const submitted = await button
		.awaitModalSubmit({ filter: (m) => m.customId === name && m.user.id === button.user.id, time: 120_000 })
		.catch(() => null);

	if (!submitted?.isFromMessage()) return null;

	await submitted.deferUpdate();

	return submitted;
}

async function normalizeTicketSettings(guildId: string, guild: Guild, settings: ServerSettings) {
	if (!settings.ticketCategoryId) return settings;

	const ticketCategory =
		guild.channels.cache.get(settings.ticketCategoryId) ??
		(await guild.channels.fetch(settings.ticketCategoryId).catch(() => null));

	if (ticketCategory?.type === ChannelType.GuildCategory) return settings;

	return updateSettings(guildId, guild.name, { ticketCategoryId: null });
}

export class SettingsCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('settings')
				.setDescription("Configure the bot's settings for this server.")
				.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
				.setContexts(InteractionContextType.Guild),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const safeEditReply = async (options: Parameters<Command.ChatInputCommandInteraction['editReply']>[0]) => {
			try {
				await interaction.editReply(options);
			} catch (error) {
				if (isStaleInteractionError(error)) return;
				throw error;
			}
		};

		const settingMenu = new StringSelectMenuBuilder()
			.setCustomId('settingOption')
			.setPlaceholder('Select a setting to modify')
			.addOptions(
				new StringSelectMenuOptionBuilder()
					.setLabel('Welcome Message')
					.setDescription('Send a message when a user joins the server.')
					.setValue('welcome'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Tickets')
					.setDescription('Configure where tickets are created.')
					.setValue('tickets'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Logging')
					.setDescription('Configure server channel logging.')
					.setValue('logging'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Confessions')
					.setDescription('Configure where confessions are posted and whether they are enabled.')
					.setValue('confessions'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Haiku')
					.setDescription('Reply when a message forms a haiku.')
					.setValue('haiku'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Auto Publisher')
					.setDescription('Automatically publish messages posted in announcement channels.')
					.setValue('autoPublisher'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Starboard')
					.setDescription('Send messages in a channel when they get enough reactions.')
					.setValue('starboard'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Scam Protection')
					.setDescription('Stop members from spamming across several channels at once.')
					.setValue('scamProtection'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Honey Pot')
					.setDescription('Trap bots with a channel that kicks anyone who posts in it.')
					.setValue('honeypot'),
			);

		const response = await interaction.reply({
			components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(settingMenu)],
			flags: MessageFlags.Ephemeral,
			withResponse: true,
		});

		const collectorFilter = (i: MessageComponentInteraction) =>
			i.user.id === interaction.user.id && (i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false);

		try {
			const settingChoice = await import('#utils/collectors.js').then((m) =>
				m.awaitMessageComponentSafe(response.resource!.message!, { filter: collectorFilter, time: 60_000 }),
			);

			if (!settingChoice) {
				await safeEditReply({
					embeds: [errorEmbed(`${emojis.rightArrow2} No response within a minute or errored.`)],
					components: [],
				});
				return;
			}

			if (!settingChoice.isStringSelectMenu()) return;

			const guildId = interaction.guildId;
			const guild = interaction.guild;

			if (!guildId || !guild) {
				await settingChoice.update({
					embeds: [errorEmbed(`${emojis.rightArrow2} This command can only be used in a server.`)],
					components: [],
				});
				return;
			}

			const settings = await normalizeTicketSettings(guildId, guild, await getSettings(guildId));

			const applySettings = async (i: MessageComponentInteraction, patch: Partial<ServerSettings>) => { // migration from "updateSettings" as we now also log changes
				const before = await getSettings(guildId);
				const next = await updateSettings(guildId, guild.name, patch);

				await logSettingsChange(guild, i.user, before, next);

				return next;
			};

			if (settingChoice.values[0] === 'welcome') {
				await settingChoice.update(buildWelcomePanel(settings, guild));
			} else if (settingChoice.values[0] === 'tickets') {
				await settingChoice.update(buildTicketPanel(settings, guild));
			} else if (settingChoice.values[0] === 'logging') {
				await settingChoice.update(buildLoggingPanel(settings, guild));
			} else if (settingChoice.values[0] === 'confessions') {
				await settingChoice.update(buildConfessionPanel(settings, guild));
			} else if (settingChoice.values[0] === 'haiku') {
				await settingChoice.update(buildHaikuPanel(settings));
			} else if (settingChoice.values[0] === 'autoPublisher') {
				await settingChoice.update(buildAutoPublisherPanel(settings));
			} else if (settingChoice.values[0] === 'starboard') {
				await settingChoice.update(buildStarboardPanel(settings, guild));
			} else if (settingChoice.values[0] === 'scamProtection') {
				await settingChoice.update(buildScamProtectionPanel(settings, guild));
			} else if (settingChoice.values[0] === 'honeypot') {
				await settingChoice.update(buildHoneypotPanel(settings));
			} else {
				return;
			}

			const collector = settingChoice.message.createMessageComponentCollector({
				filter: collectorFilter,
				time: 60_000,
			});

			collector.on('collect', async (i) => {
				if (i.customId === 'welcomeToggle' && i.isStringSelectMenu()) {
					const enable = i.values[0] === 'enable';
					const next = await applySettings(i, { welcomePeople: enable });

					await i.update(buildWelcomePanel(next, guild, `Welcome module **${enable ? 'enabled' : 'disabled'}**.`));
				} else if (i.customId === 'welcomeChannel' && i.isChannelSelectMenu()) {
					const channelId = i.values[0];
					const next = await applySettings(i, { welcomeChannelId: channelId });

					await i.update(buildWelcomePanel(next, guild, `Welcome channel set to <#${channelId}>.`));
				} else if (i.customId === 'ticketCategory' && i.isChannelSelectMenu()) {
					const categoryId = i.values[0];
					const next = await applySettings(i, { ticketCategoryId: categoryId });

					await i.update(buildTicketPanel(next, guild, `Ticket category set to <#${categoryId}>.`));
				} else if (i.customId === 'ticketCategoryRemove' && i.isButton()) {
					const next = await applySettings(i, { ticketCategoryId: null });

					await i.update(buildTicketPanel(next, guild, 'Ticket category removed.'));
				} else if (i.customId === 'staffRole' && i.isRoleSelectMenu()) {
					const roleId = i.values[0];
					const next = await applySettings(i, { staffRole: roleId });

					await i.update(buildTicketPanel(next, guild, `Ticket staff role set to <@&${roleId}>.`));
				} else if (i.customId === 'removeStaffRole' && i.isButton()) {
					const next = await applySettings(i, { staffRole: null });

					await i.update(buildTicketPanel(next, guild, 'Ticket staff role removed.'));
				} else if (i.customId === 'ticketTranscriptChannel' && i.isChannelSelectMenu()) {
					const channelId = i.values[0];
					const next = await applySettings(i, { ticketTranscriptChannelId: channelId });

					await i.update(buildTicketPanel(next, guild, `Ticket transcript channel set to <#${channelId}>.`));
				} else if (i.customId === 'removeTranscriptChannel' && i.isButton()) {
					const next = await applySettings(i, { ticketTranscriptChannelId: null });

					await i.update(buildTicketPanel(next, guild, 'Ticket transcript channel removed.'));
				} else if (i.customId === 'loggingToggle' && i.isStringSelectMenu()) {
					const enable = i.values[0] === 'enable';
					const next = await applySettings(i, { loggingEnabled: enable });

					await i.update(buildLoggingPanel(next, guild, `Logging module **${enable ? 'enabled' : 'disabled'}**.`));
				} else if (i.customId === 'loggingChannel' && i.isChannelSelectMenu()) {
					const channelId = i.values[0];
					const next = await applySettings(i, { loggingChannelId: channelId });

					await i.update(buildLoggingPanel(next, guild, `Logging channel set to <#${channelId}>.`));
				} else if (i.customId === 'confessionToggle' && i.isStringSelectMenu()) {
					const enable = i.values[0] === 'enable';
					const next = await applySettings(i, { confessionEnabled: enable });

					await i.update(buildConfessionPanel(next, guild, `Confessions **${enable ? 'enabled' : 'disabled'}**.`));
				} else if (i.customId === 'confessionChannel' && i.isChannelSelectMenu()) {
					const channelId = i.values[0];
					const next = await applySettings(i, { confessionChannelId: channelId });

					await i.update(buildConfessionPanel(next, guild, `Confession channel set to <#${channelId}>.`));
				} else if (i.customId === 'haikuToggle' && i.isStringSelectMenu()) {
					const enable = i.values[0] === 'enable';
					const next = await applySettings(i, { haikuEnabled: enable });

					await i.update(buildHaikuPanel(next, `Haiku **${enable ? 'enabled' : 'disabled'}**.`));
				} else if (i.customId === 'autoPublisherToggle' && i.isStringSelectMenu()) {
					const enable = i.values[0] === 'enable';
					const next = await applySettings(i, { autoPublisher: enable });

					await i.update(buildAutoPublisherPanel(next, `Auto Publisher **${enable ? 'enabled' : 'disabled'}**.`));
				} else if (i.customId === 'starboardToggle' && i.isStringSelectMenu()) {
					const enable = i.values[0] === 'enable';
					const next = await applySettings(i, { starboardEnable: enable });

					await i.update(buildStarboardPanel(next, guild, `Starboard **${enable ? 'enabled' : 'disabled'}**.`));
				} else if (i.customId === 'starboardChannel' && i.isChannelSelectMenu()) {
					const channelId = i.values[0];
					const next = await applySettings(i, { starboardChannelId: channelId });

					await i.update(buildStarboardPanel(next, guild, `Starboard channel set to <#${channelId}>.`));
				} else if (i.customId === 'starboardCount' && i.isButton()) {
					const current = await getSettings(guildId);

					const submitted = await promptForValue(
						i,
						'starboardCountModal',
						'Reactions Required',
						`How many reactions are required? (1-99)`,
						new TextInputBuilder()
							.setCustomId('value')
							.setStyle(TextInputStyle.Short)
							.setRequired(true)
							.setMinLength(1)
							.setMaxLength(2)
							.setValue(String(current.starboardRequirement)),
					);

					if (!submitted) return;

					const requirement = Number(submitted.fields.getTextInputValue('value').trim());

					if (!Number.isInteger(requirement) || requirement < 1 || requirement > 99) {
						await submitted.editReply(
							buildStarboardPanel(current, guild, 'That must be a whole number between 1 and 99.'),
						);
						return;
					}

					const next = await applySettings(i, { starboardRequirement: requirement });

					await submitted.editReply(
						buildStarboardPanel(
							next,
							guild,
							`Starboard now requires **${requirement}** reaction${requirement === 1 ? '' : 's'}.`,
						),
					);
				} else if (i.customId === 'starboardEmoji' && i.isButton()) {
					const current = await getSettings(guildId);

					const submitted = await promptForValue(
						i,
						'starboardEmojiModal',
						'Starboard Emoji',
						'Which emoji should be used?',
						new TextInputBuilder()
							.setCustomId('value')
							.setStyle(TextInputStyle.Short)
							.setRequired(true)
							.setMaxLength(64)
							.setValue(current.starboardEmoji),
					);

					if (!submitted) return;

					const emoji = submitted.fields.getTextInputValue('value').trim();
					const custom = /^<a?:\w{2,32}:(\d{17,20})>$/.exec(emoji); // regex for custom emojis

					if (
						!custom &&
						!/^\p{Extended_Pictographic}(?:\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|️|‍)*$/u.test(emoji)
					) {
						// if it wasnt a custom emoji, so is it a unicode emoji (regex)
						await submitted.editReply(buildStarboardPanel(current, guild, `${emoji} is not a valid emoji.`));
						return;
					}

					if (custom && !guild.emojis.cache.has(custom[1])) {
						await submitted.editReply(buildStarboardPanel(current, guild, 'That emoji is not from this server.'));
						return;
					}

					const next = await applySettings(i, { starboardEmoji: emoji });

					await submitted.editReply(buildStarboardPanel(next, guild, `Starboard emoji set to ${emoji}.`));
				} else if (i.customId === 'scamProtectionToggle' && i.isStringSelectMenu()) {
					const enable = i.values[0] === 'enable';
					const next = await applySettings(i, { scamProtectionEnabled: enable });

					await i.update(
						buildScamProtectionPanel(next, guild, `Scam Protection **${enable ? 'enabled' : 'disabled'}**.`),
					);
				} else if (i.customId === 'scamProtectionAction' && i.isStringSelectMenu()) {
					const value = i.values[0];
					if (!value || !(value in SCAM_ACTIONS)) return; // exported from lib/scamProtection.ts

					const action = value as ScamAction;
					const next = await applySettings(i, { scamProtectionAction: action });

					await i.update(buildScamProtectionPanel(next, guild, `Scam Protection set to **${SCAM_ACTIONS[action]}**.`));
				} else if (i.customId === 'exemptionRole' && i.isRoleSelectMenu()) {
					const roleId = i.values[0];
					const next = await applySettings(i, { scamProtectionExemptionRole: roleId });

					await i.update(buildScamProtectionPanel(next, guild, `Exemption role set to <@&${roleId}>.`));
				} else if (i.customId === 'removeExemptionRole' && i.isButton()) {
					const next = await applySettings(i, { scamProtectionExemptionRole: null });

					await i.update(buildScamProtectionPanel(next, guild, 'Exemption role removed.'));
				} else if (i.customId === 'honeypotCreate' && i.isButton()) {
					await i.deferUpdate();

					const current = await getSettings(guildId);

					if (current.honeypotChannelId) {
						await i.editReply(buildHoneypotPanel(current, 'The honey pot channel already exists.'));
						return;
					}

					const channel = await createHoneypot(guild).catch((err) => {
						console.error(err);
						return null;
					});

					if (!channel) {
						await i.editReply(
							buildHoneypotPanel(
								current,
								'I could not create the channel. Please make sure I have the correct permissions.',
							),
						);
						return;
					}

					const next = await applySettings(i, { honeypotChannelId: channel.id });

					await i.editReply(buildHoneypotPanel(next, `Honey Pot channel created at <#${channel.id}>.`));
				} else if (i.customId === 'honeypotDelete' && i.isButton()) {
					await i.deferUpdate();

					const current = await getSettings(guildId);
					if (current.honeypotChannelId) await deleteHoneypot(guild, current.honeypotChannelId);

					const next = await applySettings(i, { honeypotChannelId: null });

					await i.editReply(buildHoneypotPanel(next, 'Honey Pot channel deleted.'));
				}
			});

			collector.on('end', async () => {
				await safeEditReply({
					embeds: [infoEmbed(`${emojis.rightArrow2} Closed.`)],
					components: [],
				});
			});
		} catch (err) {
			console.error(err);
			await safeEditReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} No response within a minute or errored.`)],
				components: [],
			});
		}
	}
}
