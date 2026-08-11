// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ChannelType,
	InteractionContextType,
	type Message,
	type MessageComponentInteraction,
	MessageFlags,
	PermissionFlagsBits,
	RoleSelectMenuBuilder,
} from 'discord.js';
import { logSettingsChange } from '#lib/logging.js';
import { getSettings, type ServerSettings, updateSettings } from '#lib/settings.js';
import { awaitMessageComponentSafe } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
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

const STEP_TIMEOUT = 180_000;

function yesNoRow() {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('setup_yes').setLabel('Yes, enable it').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId('setup_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
	);
}

function nextSkipRow() {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('setup_next').setLabel('Next').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId('setup_skip').setLabel('Skip this feature').setStyle(ButtonStyle.Secondary),
	);
}

async function runCollector(
	message: Message,
	filter: (i: MessageComponentInteraction) => boolean,
	timeout: number,
	handler: (i: MessageComponentInteraction, stop: () => void) => Promise<void>,
): Promise<boolean> {
	return new Promise((resolve) => {
		const collector = message.createMessageComponentCollector({ filter, time: timeout });
		let stopped = false;

		const stop = () => {
			if (stopped) return;
			stopped = true;
			collector.stop('done');
		};

		collector.on('collect', async (i) => {
			await handler(i, stop);
		});

		collector.on('end', (_, reason) => {
			resolve(reason === 'done');
		});
	});
}

export class SetupCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('setup')
				.setDescription('Guided setup to configure the bot for this server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
				.setContexts(InteractionContextType.Guild),
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

		const { guildId, guild } = interaction;
		const collectorFilter = (i: MessageComponentInteraction) =>
			i.user.id === interaction.user.id && (i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false);

		const safeEditReply = async (options: Parameters<Command.ChatInputCommandInteraction['editReply']>[0]) => {
			try {
				await interaction.editReply(options);
			} catch (error) {
				if (isStaleInteractionError(error)) return;
				throw error;
			}
		};

		const response = await interaction.reply({
			embeds: [
				infoEmbed(
					[
						`**Server Setup**`,
						`${emojis.rightArrow1} This wizard will walk you through configuring the bot's features.`,
						`${emojis.rightArrow1} You can adjust anything later with \`/settings\`.`,
						`**Please put the newly created Quest role at the top of the role list!**`,
					].join('\n'),
				),
			],
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId('setup_start').setLabel('Get Started').setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId('setup_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
				),
			],
			flags: MessageFlags.Ephemeral,
			withResponse: true,
		});

		const message = response.resource!.message!;

		const startChoice = await awaitMessageComponentSafe(message, {
			filter: collectorFilter,
			time: STEP_TIMEOUT,
		});

		if (!startChoice || startChoice.customId === 'setup_cancel') {
			await safeEditReply({ embeds: [infoEmbed(`${emojis.rightArrow2} Setup cancelled.`)], components: [] });
			return;
		}

		let settings = await getSettings(guildId);
		const summary: string[] = [];

		const applySettings = async (patch: Partial<ServerSettings>) => {
			// migration from just "settings = " as we now also log changes
			const before = settings;
			settings = await updateSettings(guildId, guild.name, patch);

			await logSettingsChange(guild, interaction.user, before, settings);
		};

		// 1. welcome messages
		await startChoice.update({
			embeds: [
				infoEmbed(
					[
						`**Setup (1/4) Welcome Messages**`,
						`${emojis.rightArrow1} Would you like to send a welcome message when someone joins?`,
					].join('\n'),
				),
			],
			components: [yesNoRow()],
		});

		const welcomeFeatureChoice = await awaitMessageComponentSafe(message, {
			filter: collectorFilter,
			time: STEP_TIMEOUT,
		});

		if (!welcomeFeatureChoice) {
			await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
			return;
		}

		if (welcomeFeatureChoice.customId === 'setup_yes') {
			let welcomeChannelId: string | null = null;

			const buildWelcomeConfigPanel = (status?: string) => ({
				embeds: [
					infoEmbed(
						[
							`**Setup (1/4) Welcome Messages**`,
							`${emojis.rightArrow1} Select the channel for welcome messages.`,
							status ? `${emojis.rightArrow2} ${status}` : `${emojis.rightArrow1} Click **Next** when ready.`,
						].join('\n'),
					),
				],
				components: [
					new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
						new ChannelSelectMenuBuilder()
							.setCustomId('setup_welcome_channel')
							.setPlaceholder(
								welcomeChannelId
									? `${guild.channels.cache.get(welcomeChannelId)?.name ?? 'selected'}`
									: 'Select a channel',
							)
							.setChannelTypes(ChannelType.GuildText),
					),
					nextSkipRow(),
				],
			});

			await welcomeFeatureChoice.update(buildWelcomeConfigPanel());

			const completed = await runCollector(message, collectorFilter, STEP_TIMEOUT, async (i, stop) => {
				if (i.customId === 'setup_welcome_channel' && i.isChannelSelectMenu()) {
					welcomeChannelId = i.values[0];
					await i.update(
						buildWelcomeConfigPanel(`Welcome channel set to <#${welcomeChannelId}>. Click **Next** to continue.`),
					);
				} else if (i.customId === 'setup_next' && i.isButton()) {
					await i.deferUpdate();
					stop();
				} else if (i.customId === 'setup_skip' && i.isButton()) {
					welcomeChannelId = null;
					await i.deferUpdate();
					stop();
				}
			});

			if (!completed) {
				await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
				return;
			}

			if (welcomeChannelId) {
				await applySettings({
					welcomePeople: true,
					welcomeChannelId,
				});
				summary.push(`${emojis.rightArrow2} **Welcome Messages** enabled in <#${welcomeChannelId}>`);
			} else {
				summary.push(`${emojis.rightArrow2} **Welcome Messages** skipped`);
			}
		} else {
			await welcomeFeatureChoice.deferUpdate();
			summary.push(`${emojis.rightArrow2} **Welcome Messages** skipped`);
		}

		// 2: tickets
		await safeEditReply({
			embeds: [
				infoEmbed([`**Setup (2/4) Tickets**`, `${emojis.rightArrow1} Would you like to enable tickets?`].join('\n')),
			],
			components: [yesNoRow()],
		});

		const ticketsFeatureChoice = await awaitMessageComponentSafe(message, {
			filter: collectorFilter,
			time: STEP_TIMEOUT,
		});

		if (!ticketsFeatureChoice) {
			await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
			return;
		}

		if (ticketsFeatureChoice.customId === 'setup_yes') {
			let ticketCategoryId: string | null = null;
			let staffRoleId: string | null = null;
			let transcriptChannelId: string | null = null;

			const buildTicketConfigPanel = (status?: string) => ({
				embeds: [
					infoEmbed(
						[
							`**Setup (2/4) Tickets**`,
							`${emojis.rightArrow1} Configure the ticket system below. Staff role and transcript channel are optional.`,
							status ? `${emojis.rightArrow2} ${status}` : `${emojis.rightArrow1} Click **Next** when ready.`,
						].join('\n'),
					),
				],
				components: [
					new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
						new ChannelSelectMenuBuilder()
							.setCustomId('setup_ticket_category')
							.setPlaceholder(
								ticketCategoryId
									? `#${guild.channels.cache.get(ticketCategoryId)?.name ?? 'selected'}`
									: 'Select a ticket category (required)',
							)
							.setChannelTypes(ChannelType.GuildCategory),
					),
					new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
						new RoleSelectMenuBuilder()
							.setCustomId('setup_ticket_staff_role')
							.setPlaceholder(
								staffRoleId
									? (guild.roles.cache.get(staffRoleId)?.name ?? 'selected')
									: 'Select a staff role (optional)',
							),
					),
					new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
						new ChannelSelectMenuBuilder()
							.setCustomId('setup_ticket_transcript')
							.setPlaceholder(
								transcriptChannelId
									? `#${guild.channels.cache.get(transcriptChannelId)?.name ?? 'selected'}`
									: 'Select a transcript channel (optional)',
							)
							.setChannelTypes(ChannelType.GuildText),
					),
					nextSkipRow(),
				],
			});

			await ticketsFeatureChoice.update(buildTicketConfigPanel());

			const completed = await runCollector(message, collectorFilter, STEP_TIMEOUT, async (i, stop) => {
				if (i.customId === 'setup_ticket_category' && i.isChannelSelectMenu()) {
					ticketCategoryId = i.values[0];
					await i.update(buildTicketConfigPanel(`Ticket category set to <#${ticketCategoryId}>.`));
				} else if (i.customId === 'setup_ticket_staff_role' && i.isRoleSelectMenu()) {
					staffRoleId = i.values[0];
					await i.update(buildTicketConfigPanel(`Staff role set to <@&${staffRoleId}>.`));
				} else if (i.customId === 'setup_ticket_transcript' && i.isChannelSelectMenu()) {
					transcriptChannelId = i.values[0];
					await i.update(buildTicketConfigPanel(`Transcript channel set to <#${transcriptChannelId}>.`));
				} else if (i.customId === 'setup_next' && i.isButton()) {
					await i.deferUpdate();
					stop();
				} else if (i.customId === 'setup_skip' && i.isButton()) {
					ticketCategoryId = null;
					staffRoleId = null;
					transcriptChannelId = null;
					await i.deferUpdate();
					stop();
				}
			});

			if (!completed) {
				await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
				return;
			}

			if (ticketCategoryId) {
				await applySettings({
					ticketCategoryId,
					staffRole: staffRoleId,
					ticketTranscriptChannelId: transcriptChannelId,
				});
				summary.push(`${emojis.rightArrow2} **Tickets** enabled`);

				// sub-panel: post ticket panel
				await safeEditReply({
					embeds: [
						infoEmbed(
							[
								`**Setup (2/4) Ticket Panel**`,
								`${emojis.rightArrow1} Would you like to post the ticket creation panel in a channel?`,
								`${emojis.rightArrow1} Members click a button in that channel to open a ticket.`,
							].join('\n'),
						),
					],
					components: [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder().setCustomId('setup_yes').setLabel('Yes!').setStyle(ButtonStyle.Success),
							new ButtonBuilder().setCustomId('setup_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
						),
					],
				});

				const panelChoice = await awaitMessageComponentSafe(message, {
					filter: collectorFilter,
					time: STEP_TIMEOUT,
				});

				if (!panelChoice) {
					await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
					return;
				}

				if (panelChoice.customId === 'setup_yes') {
					let panelChannelId: string | null = null;

					const buildPanelChannelPanel = (status?: string) => ({
						embeds: [
							infoEmbed(
								[
									`**Setup (2/4) Ticket Panel**`,
									`${emojis.rightArrow1} Select the channel to post the ticket creation panel in.`,
									status ? `${emojis.rightArrow2} ${status}` : `${emojis.rightArrow1} Click **Send Panel** when ready.`,
								].join('\n'),
							),
						],
						components: [
							new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
								new ChannelSelectMenuBuilder()
									.setCustomId('setup_panel_channel')
									.setPlaceholder(
										panelChannelId
											? `#${guild.channels.cache.get(panelChannelId)?.name ?? 'selected'}`
											: 'Select a channel',
									)
									.setChannelTypes(ChannelType.GuildText),
							),
							new ActionRowBuilder<ButtonBuilder>().addComponents(
								new ButtonBuilder().setCustomId('setup_send').setLabel('Send Panel').setStyle(ButtonStyle.Primary),
								new ButtonBuilder().setCustomId('setup_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
							),
						],
					});

					await panelChoice.update(buildPanelChannelPanel());

					await runCollector(message, collectorFilter, STEP_TIMEOUT, async (i, stop) => {
						if (i.customId === 'setup_panel_channel' && i.isChannelSelectMenu()) {
							panelChannelId = i.values[0];
							await i.update(
								buildPanelChannelPanel(`Panel will be sent in <#${panelChannelId}>. Click **Send Panel** to post it.`),
							);
						} else if (i.customId === 'setup_send' && i.isButton()) {
							if (panelChannelId) {
								const panelChannel = guild.channels.cache.get(panelChannelId);
								if (panelChannel?.isTextBased()) {
									await panelChannel.send({
										content: '**Create a ticket by clicking the button below!**',
										components: [
											new ActionRowBuilder<ButtonBuilder>().addComponents(
												new ButtonBuilder()
													.setCustomId('create-ticket')
													.setLabel('Create Ticket')
													.setStyle(ButtonStyle.Success),
											),
										],
									});
								}
							}
							await i.deferUpdate();
							stop();
						} else if (i.customId === 'setup_skip' && i.isButton()) {
							await i.deferUpdate();
							stop();
						}
					});
				} else {
					await panelChoice.deferUpdate();
				}
			} else {
				summary.push(`${emojis.rightArrow2} **Tickets** skipped`);
			}
		} else {
			await ticketsFeatureChoice.deferUpdate();
			summary.push(`${emojis.rightArrow2} **Tickets** skipped`);
		}

		// 3: logging
		await safeEditReply({
			embeds: [
				infoEmbed(
					[
						`**Setup (3/4) Logging**`,
						`${emojis.rightArrow1} Would you like to log server events (bans, kicks, message deletions, etc.) in a channel?`,
					].join('\n'),
				),
			],
			components: [yesNoRow()],
		});

		const loggingFeatureChoice = await awaitMessageComponentSafe(message, {
			filter: collectorFilter,
			time: STEP_TIMEOUT,
		});

		if (!loggingFeatureChoice) {
			await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
			return;
		}

		if (loggingFeatureChoice.customId === 'setup_yes') {
			let loggingChannelId: string | null = null;

			const buildLoggingConfigPanel = (status?: string) => ({
				embeds: [
					infoEmbed(
						[
							`**Setup (3/4) Logging**`,
							`${emojis.rightArrow1} Select the channel where server events will be logged.`,
							status ? `${emojis.rightArrow2} ${status}` : `${emojis.rightArrow1} Click **Next** when ready.`,
						].join('\n'),
					),
				],
				components: [
					new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
						new ChannelSelectMenuBuilder()
							.setCustomId('setup_logging_channel')
							.setPlaceholder(
								loggingChannelId
									? `#${guild.channels.cache.get(loggingChannelId)?.name ?? 'selected'}`
									: 'Select a channel',
							)
							.setChannelTypes(ChannelType.GuildText),
					),
					nextSkipRow(),
				],
			});

			await loggingFeatureChoice.update(buildLoggingConfigPanel());

			const completed = await runCollector(message, collectorFilter, STEP_TIMEOUT, async (i, stop) => {
				if (i.customId === 'setup_logging_channel' && i.isChannelSelectMenu()) {
					loggingChannelId = i.values[0];
					await i.update(
						buildLoggingConfigPanel(`Logging channel set to <#${loggingChannelId}>. Click **Next** to continue.`),
					);
				} else if (i.customId === 'setup_next' && i.isButton()) {
					await i.deferUpdate();
					stop();
				} else if (i.customId === 'setup_skip' && i.isButton()) {
					loggingChannelId = null;
					await i.deferUpdate();
					stop();
				}
			});

			if (!completed) {
				await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
				return;
			}

			if (loggingChannelId) {
				await applySettings({
					loggingEnabled: true,
					loggingChannelId,
				});
				summary.push(`${emojis.rightArrow2} **Logging** enabled, channel: <#${loggingChannelId}>`);
			} else {
				summary.push(`${emojis.rightArrow1} **Logging** skipped`);
			}
		} else {
			await loggingFeatureChoice.deferUpdate();
			summary.push(`${emojis.rightArrow1} **Logging** skipped`);
		}

		// 4: confessions
		await safeEditReply({
			embeds: [
				infoEmbed(
					[`**Setup (4/4) Confessions**`, `${emojis.rightArrow1} Would you like to enable confessions?`].join('\n'),
				),
			],
			components: [yesNoRow()],
		});

		const confessionsFeatureChoice = await awaitMessageComponentSafe(message, {
			filter: collectorFilter,
			time: STEP_TIMEOUT,
		});

		if (!confessionsFeatureChoice) {
			await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
			return;
		}

		if (confessionsFeatureChoice.customId === 'setup_yes') {
			let confessionChannelId: string | null = null;

			const buildConfessionConfigPanel = (status?: string) => ({
				embeds: [
					infoEmbed(
						[
							`**Setup (4/4) Confessions**`,
							`${emojis.rightArrow1} Select the channel where anonymous confessions will be posted.`,
							status ? `${emojis.rightArrow2} ${status}` : `${emojis.rightArrow1} Click **Next** when ready.`,
						].join('\n'),
					),
				],
				components: [
					new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
						new ChannelSelectMenuBuilder()
							.setCustomId('setup_confession_channel')
							.setPlaceholder(
								confessionChannelId
									? `#${guild.channels.cache.get(confessionChannelId)?.name ?? 'selected'}`
									: 'Select a channel',
							)
							.setChannelTypes(ChannelType.GuildText),
					),
					nextSkipRow(),
				],
			});

			await confessionsFeatureChoice.update(buildConfessionConfigPanel());

			const completed = await runCollector(message, collectorFilter, STEP_TIMEOUT, async (i, stop) => {
				if (i.customId === 'setup_confession_channel' && i.isChannelSelectMenu()) {
					confessionChannelId = i.values[0];
					await i.update(
						buildConfessionConfigPanel(
							`Confession channel set to <#${confessionChannelId}>. Click **Next** to continue.`,
						),
					);
				} else if (i.customId === 'setup_next' && i.isButton()) {
					await i.deferUpdate();
					stop();
				} else if (i.customId === 'setup_skip' && i.isButton()) {
					confessionChannelId = null;
					await i.deferUpdate();
					stop();
				}
			});

			if (!completed) {
				await safeEditReply({ embeds: [errorEmbed(`${emojis.rightArrow2} Setup timed out.`)], components: [] });
				return;
			}

			if (confessionChannelId) {
				await applySettings({
					confessionEnabled: true,
					confessionChannelId,
				});
				summary.push(`${emojis.rightArrow2} **Confessions** enabled in <#${confessionChannelId}>`);
			} else {
				summary.push(`${emojis.rightArrow2} **Confessions** skipped`);
			}
		} else {
			await confessionsFeatureChoice.deferUpdate();
			summary.push(`${emojis.rightArrow2} **Confessions** skipped`);
		}

		await safeEditReply({
			embeds: [
				successEmbed(
					[
						`**Here's what was configured:**`,
						...summary,
						'',
						`**What's next?**`,
						`${emojis.rightArrow1} Use \`/automod add\` to block words in your server.`,
						`${emojis.rightArrow1} Use \`/autorole add\` to assign roles to new members automatically.`,
						`${emojis.rightArrow1} Use \`/settings\` to adjust any of these at any time.`,
					].join('\n'),
				),
			],
			components: [],
		});
	}
}
