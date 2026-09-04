// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	EmbedBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { getConfessionContext, getModeratorIds, removeConfessionContext } from '#lib/confessions.js';
import { logger } from '#lib/logger.js';
import { emojis } from '#utils/emoji.js';

interface ParsedConfessionButton {
	action: string;
	messageId?: string;
	guildId?: string;
	channelId?: string;
}

function parseConfessionButton(customId: string): ParsedConfessionButton {
	const [action, ...parts] = customId.split(':');
	const result: ParsedConfessionButton = { action };

	if (action === 'delete-confession' && parts.length >= 3) {
		[result.guildId, result.channelId, result.messageId] = parts;
	} else if (parts.length > 0) {
		[result.messageId] = parts;
	}

	return result;
}

function createTextInputModal(customId: string, title: string, inputId: string, label: string) {
	const input = new TextInputBuilder()
		.setCustomId(inputId)
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(true)
		.setMaxLength(1_000);

	return new ModalBuilder()
		.setCustomId(customId)
		.setTitle(title)
		.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
}

async function fetchConfessionChannel(interaction: ButtonInteraction, channelId: string, guildId?: string) {
	try {
		let channel = null;

		if (guildId) {
			const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
			if (guild) {
				channel = await guild.channels.fetch(channelId).catch(() => null);
			}
		} else if (interaction.inGuild() && interaction.guild) {
			channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
		}

		if (!channel) {
			channel = await interaction.client.channels.fetch(channelId).catch(() => null);
		}

		return channel?.isTextBased() ? channel : null;
	} catch {
		return null;
	}
}

export class ConfessionButtonHandler extends InteractionHandler {
	public constructor(ctx: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
		super(ctx, {
			...options,
			interactionHandlerType: InteractionHandlerTypes.Button,
		});
	}

	public override parse(interaction: ButtonInteraction) {
		if (
			!interaction.customId.startsWith('report-confession:') &&
			!interaction.customId.startsWith('delete-confession:')
		) {
			return this.none();
		}

		return this.some();
	}

	public async run(interaction: ButtonInteraction) {
		const parsed = parseConfessionButton(interaction.customId);

		if (parsed.action === 'report-confession') {
			await this.handleReportConfession(interaction, parsed);
			return;
		}

		if (parsed.action === 'delete-confession') {
			await this.handleDeleteConfession(interaction, parsed);
		}
	}

	private async handleReportConfession(interaction: ButtonInteraction, parsed: ParsedConfessionButton) {
		if (!interaction.inGuild() || !interaction.guild || !parsed.messageId) {
			await interaction.reply({
				content: `${emojis.rightArrow2} This confession cannot be reported right now.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const context = await getConfessionContext(parsed.messageId);

		if (!context) {
			await interaction.reply({
				content: `${emojis.rightArrow2} This confession is no longer available.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const moderators = getModeratorIds();

		if (moderators.length === 0) {
			await interaction.reply({
				content: `${emojis.rightArrow2} No bot moderators are configured.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const modal = createTextInputModal(
			`report-confession-modal:${parsed.messageId}`,
			'Report Confession',
			'confession-report-reason',
			'Reason',
		);

		await interaction.showModal(modal);

		let modalSubmit: ModalSubmitInteraction;

		try {
			modalSubmit = await interaction.awaitModalSubmit({
				filter: (modal) =>
					modal.customId === `report-confession-modal:${parsed.messageId}` && modal.user.id === interaction.user.id,
				time: 60_000,
			});
		} catch {
			return;
		}

		const reason = modalSubmit.fields.getTextInputValue('confession-report-reason');
		await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral });

		const channel = await fetchConfessionChannel(interaction, context.channelId);

		if (!channel) {
			logger.error('Confession channel fetch failed', { channelId: context.channelId, context });
			await modalSubmit.editReply({
				content: `${emojis.rightArrow2} The confession channel (<#${context.channelId}>) is no longer available.`,
			});
			return;
		}

		const message = await channel.messages.fetch(context.messageId).catch(() => null);

		if (!message) {
			await modalSubmit.editReply({
				content: `${emojis.rightArrow2} That confession no longer exists.`,
			});
			return;
		}

		const deleteButton = new ButtonBuilder()
			.setCustomId(`delete-confession:${context.guildId}:${context.channelId}:${context.messageId}`)
			.setLabel('Delete Confession')
			.setStyle(ButtonStyle.Danger);

		const confessionText = message.embeds[0]?.description ?? 'No confession content was found.';
		const link = `https://discord.com/channels/${context.guildId}/${context.channelId}/${context.messageId}`;

		let confessorDisplay = 'Unknown';
		if (context.creatorId) {
			const confessorUser = await interaction.client.users.fetch(context.creatorId).catch(() => null);
			confessorDisplay = confessorUser ? `${confessorUser.tag} (${confessorUser.id})` : context.creatorId;
		}

		const reportEmbed = new EmbedBuilder()
			.setTitle('Confession Reported')
			.addFields(
				{ name: 'Guild', value: `${interaction.guild.name} (${interaction.guild.id})` },
				{ name: 'Channel', value: `<#${context.channelId}>` },
				{ name: 'Reported by', value: `${modalSubmit.user.tag} (${modalSubmit.user.id})` },
				{ name: 'Confessor', value: confessorDisplay },
				{ name: 'Reason', value: reason },
				{ name: 'Confession', value: confessionText.slice(0, 1024) },
				{ name: 'Link', value: link },
			)
			.setTimestamp();

		const deliveries = await Promise.allSettled(
			moderators.map((moderatorId) => this.sendReportToModerator(interaction, moderatorId, reportEmbed, deleteButton)),
		);

		const delivered = deliveries.some((result) => result.status === 'fulfilled');

		if (!delivered) {
			await modalSubmit.editReply({
				content: `${emojis.rightArrow2} I could not contact any configured moderators.`,
			});
			return;
		}

		await modalSubmit.editReply({
			content: `${emojis.rightArrow1} Your report was sent to the bot moderators.`,
		});
	}

	private async sendReportToModerator(
		interaction: ButtonInteraction,
		moderatorId: string,
		reportEmbed: EmbedBuilder,
		deleteButton: ButtonBuilder,
	) {
		const user = await interaction.client.users.fetch(moderatorId);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(deleteButton);
		await user.send({ embeds: [reportEmbed], components: [row] });
	}

	private async handleDeleteConfession(interaction: ButtonInteraction, parsed: ParsedConfessionButton) {
		if (interaction.inGuild() || !parsed.messageId) {
			await interaction.reply({
				content: `${emojis.rightArrow2} This action can only be used from a moderator DM.`,
			});
			return;
		}

		const moderatorIds = getModeratorIds();

		if (!moderatorIds.includes(interaction.user.id)) {
			await interaction.reply({
				content: `${emojis.rightArrow2} You are not configured as a bot moderator.`,
			});
			return;
		}

		await interaction.deferReply();

		let storedContext = null;

		try {
			storedContext = await getConfessionContext(parsed.messageId);
		} catch (error) {
			logger.error('Failed to fetch confession context', { messageId: parsed.messageId, error });
		}

		const context =
			storedContext ??
			(parsed.guildId && parsed.channelId
				? { guildId: parsed.guildId, channelId: parsed.channelId, messageId: parsed.messageId, threadId: '' }
				: null);

		if (!context) {
			await interaction.editReply({
				content: `${emojis.rightArrow2} This confession is no longer available.`,
			});
			return;
		}

		const channel = await fetchConfessionChannel(interaction, context.channelId, context.guildId);

		if (!channel) {
			logger.error('Confession channel fetch failed (delete flow)', {
				channelId: context.channelId,
				guildId: context.guildId,
				context,
			});

			await removeConfessionContext(context.messageId);

			await interaction.editReply({
				content: `${emojis.rightArrow2} The confession channel (<#${context.channelId}>) is no longer available, but the confession has been removed from records.`,
			});
			return;
		}

		const message = await channel.messages.fetch(context.messageId).catch(() => null);

		if (!message) {
			await removeConfessionContext(context.messageId);

			await interaction.editReply({
				content: `${emojis.rightArrow2} That confession no longer exists, but the record has been cleaned up.`,
			});
			return;
		}

		const deletedEmbed = new EmbedBuilder()
			.setTitle('Confession')
			.setDescription('This confession was deleted by global moderators.')
			.setColor(0xed4245)
			.setTimestamp();

		try {
			await message.edit({ embeds: [deletedEmbed], components: [] });
		} catch {
			await interaction.editReply({
				content: `${emojis.rightArrow2} I could not update the confession message.`,
			});
			return;
		}

		try {
			if (context.threadId) {
				const thread = await interaction.client.channels.fetch(context.threadId).catch(() => null);
				if (thread?.isThread()) {
					await thread.setName('confession-deleted').catch(() => null);
				}
			}
		} catch (error) {
			logger.error('Failed to rename confession thread', { threadId: context.threadId, error });
		}

		await removeConfessionContext(context.messageId);

		await interaction.editReply({
			content: `${emojis.rightArrow1} Confession marked as deleted.`,
		});
	}
}
