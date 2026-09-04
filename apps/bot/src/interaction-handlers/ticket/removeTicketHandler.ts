// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import type { Attachment, ButtonInteraction, Message, TextChannel } from 'discord.js';
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { logger } from '#lib/logger.js';
import { getSettings } from '#lib/settings.js';
import { getTicketId, removeTicket } from '#lib/tickets.js';
import { emojis } from '#utils/emoji.js';

async function generateTranscript(
	channel: TextChannel,
	ticket: NonNullable<Awaited<ReturnType<typeof getTicketId>>>,
): Promise<string> {
	const messages = new Map<string, Message<true>>();
	let lastId: string | undefined;

	while (true) {
		const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
		if (fetched.size === 0) break;
		fetched.forEach((msg) => {
			messages.set(msg.id, msg);
		});
		lastId = fetched.last()?.id;
	}

	const sortedMessages = Array.from(messages.values()).reverse();

	let transcript = `Ticket <${ticket.ticketNumber}>-<@${ticket.userId}> Transcript\n`;
	transcript += `Created: ${ticket.createdAt.toLocaleString()}\n`;
	transcript += `User: <@${ticket.userId}>\n`;
	if (ticket.reason) {
		transcript += `Reason: ${ticket.reason}\n`;
	}
	transcript += `${'='.repeat(50)}\n\n`;

	for (const message of sortedMessages) {
		const timestamp = message.createdAt.toLocaleString();
		const author = message.author.tag;
		const content = message.content || '[No text content]';

		transcript += `[${timestamp}] ${author}: ${content}\n`;

		if (message.attachments.size > 0) {
			transcript += `  Attachments: ${Array.from(message.attachments.values())
				.map((a: Attachment) => a.url)
				.join(', ')}\n`;
		}
	}

	return transcript;
}

export class ButtonHandler extends InteractionHandler {
	public constructor(ctx: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
		super(ctx, {
			...options,
			interactionHandlerType: InteractionHandlerTypes.Button,
		});
	}

	public override parse(interaction: ButtonInteraction) {
		if (
			interaction.customId !== 'remove-ticket' &&
			interaction.customId !== 'confirm-remove-ticket' &&
			interaction.customId !== 'cancel-remove-ticket'
		) {
			return this.none();
		}

		return this.some();
	}

	public async run(interaction: ButtonInteraction) {
		if (!interaction.inGuild()) {
			await interaction.reply({
				content: `${emojis.rightArrow2} This button can only be used in a server.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!interaction.guild) {
			await interaction.reply({
				content: `${emojis.rightArrow2} Failed to remove ticket.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (interaction.customId === 'cancel-remove-ticket') {
			await interaction.update({
				content: `${emojis.rightArrow2} Ticket closure cancelled.`,
				components: [],
			});
			return;
		}

		const channel = interaction.channel;

		if (!channel || !('deletable' in channel) || !channel.deletable) {
			await interaction.reply({
				content: `${emojis.rightArrow2} I cannot delete this channel.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (interaction.customId === 'remove-ticket') {
			const confirmButton = new ButtonBuilder()
				.setCustomId('confirm-remove-ticket')
				.setLabel('Confirm Close')
				.setStyle(ButtonStyle.Danger);

			const cancelButton = new ButtonBuilder()
				.setCustomId('cancel-remove-ticket')
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Secondary);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

			await interaction.reply({
				content: `${emojis.rightArrow2} Are you sure you want to close this ticket?`,
				components: [row],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const reasonInput = new TextInputBuilder()
			.setCustomId('ticket-close-reason')
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(false)
			.setMaxLength(1_000);

		const reasonLabel = new LabelBuilder().setLabel('Reason for closing').setTextInputComponent(reasonInput);

		const modal = new ModalBuilder()
			.setCustomId('close-ticket-modal')
			.setTitle('Close Ticket')
			.addLabelComponents(reasonLabel);

		await interaction.showModal(modal);

		const modalSubmit = await interaction
			.awaitModalSubmit({
				filter: (modalInteraction) =>
					modalInteraction.customId === 'close-ticket-modal' && modalInteraction.user.id === interaction.user.id,
				time: 60_000,
			})
			.catch(() => null);

		if (!modalSubmit) return;

		await modalSubmit.reply({
			content: `${emojis.rightArrow2} Closing ticket...`,
			flags: MessageFlags.Ephemeral,
		});

		const rawReason = modalSubmit.fields.getTextInputValue('ticket-close-reason');
		const reason = rawReason && rawReason.trim() !== '' ? rawReason.trim() : 'No reason provided';

		if (channel.isTextBased()) {
			await channel.send({
				content: [
					`This ticket will be closed shortly.`,
					``,
					`**Closed by:** <@${interaction.user.id}>`,
					`**Reason:** ${reason}`,
				].join('\n'),
			});
		}

		await new Promise((resolve) => setTimeout(resolve, 5000));

		const ticket = await getTicketId(interaction.guild.id, channel.id);

		try {
			if (ticket && channel.isTextBased()) {
				const settings = await getSettings(interaction.guild.id);

				// Send transcript if configured
				if (settings.ticketTranscriptChannelId) {
					const transcriptChannel = await interaction.guild.channels
						.fetch(settings.ticketTranscriptChannelId)
						.catch(() => null);

					if (transcriptChannel && transcriptChannel.type === ChannelType.GuildText) {
						try {
							const transcript = await generateTranscript(channel as TextChannel, ticket);
							const attachment = new AttachmentBuilder(Buffer.from(transcript), {
								name: `ticket-${ticket.ticketNumber}-transcript.txt`,
							});

							await (transcriptChannel as TextChannel).send({
								content: `📋 **Ticket #${ticket.ticketNumber}** transcript - Closed by ${interaction.user.tag}`,
								files: [attachment],
							});
						} catch (transcriptErr) {
							logger.error('Failed to send ticket transcript:', transcriptErr);
						}
					}
				}

				await removeTicket(ticket.id);
			}

			await channel.delete(`Ticket closed by ${interaction.user.tag}. Reason: ${reason}`);
		} catch (err) {
			logger.log(err);
		}
	}
}
