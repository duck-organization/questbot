// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	type PublicThreadChannel,
	TextChannel,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { containsBlockedWord } from '#lib/automod.js';
import { isConfessionBlacklisted, storeConfessionContext } from '#lib/confessions.js';
import { getSettings } from '#lib/settings.js';
import { errorEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class ConfessCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	// I believe this command still needs some touchups

	public override registerApplicationCommands(_registry: Command.Registry) {
		_registry.registerChatInputCommand((builder) => builder.setName('confess').setDescription('Create a confession'));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inGuild() || !interaction.guild) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} This command can only be used in a server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const settings = await getSettings(interaction.guild.id);

		if (settings.confessionEnabled === false) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Confessions are disabled in this server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!settings.confessionChannelId) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Confessions are not configured in this server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const blacklistEntry = await isConfessionBlacklisted(interaction.user.id);
		if (blacklistEntry) {
			await interaction.reply({
				embeds: [
					errorEmbed(
						`${emojis.rightArrow2} You are blacklisted from confessions${blacklistEntry.reason ? ` reason: ${blacklistEntry.reason}` : ''}.`,
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const confessionInput = new TextInputBuilder()
			.setCustomId('confession-text')
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true)
			.setMaxLength(1_000);

		const confessionLabel = new LabelBuilder().setLabel('Confession').setTextInputComponent(confessionInput);

		const modal = new ModalBuilder()
			.setCustomId('create-confession-modal')
			.setTitle('Create Confession')
			.addLabelComponents(confessionLabel);

		await interaction.showModal(modal);

		let modalSubmit: ModalSubmitInteraction;

		try {
			modalSubmit = await interaction.awaitModalSubmit({
				filter: (m: ModalSubmitInteraction) =>
					m.customId === 'create-confession-modal' && m.user.id === interaction.user.id,
				time: 60_000,
			});
			await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral });
		} catch {
			return;
		}

		const confession = modalSubmit.fields.getTextInputValue('confession-text');

		if (await containsBlockedWord(interaction.guild.id, confession)) {
			await modalSubmit.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Your confession contains a word blocked by this server.`)],
			});
			return;
		}

		const confessionChannel = await interaction.guild.channels.fetch(settings.confessionChannelId).catch(() => null);

		if (!(confessionChannel instanceof TextChannel)) {
			await modalSubmit.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} The configured confession channel is unavailable.`)],
			});
			return;
		}

		const embed = new EmbedBuilder().setTitle('Confession').setDescription(confession).setTimestamp();

		const message = await confessionChannel.send({ embeds: [embed] });

		let thread: PublicThreadChannel<false>;

		try {
			const threadName = confession.replace(/\s+/g, ' ').slice(0, 20).toLowerCase() || 'confession';
			thread = await message.startThread({ name: `${threadName}` });
		} catch (error) {
			await message.delete().catch(() => null);
			throw error;
		}

		const reportButton = new ButtonBuilder()
			.setCustomId(`report-confession:${message.id}`)
			.setLabel('Report')
			.setStyle(ButtonStyle.Danger);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(reportButton);

		await message.edit({ components: [row] });

		try {
			await storeConfessionContext({
				guildId: interaction.guild.id,
				channelId: confessionChannel.id,
				messageId: message.id,
				threadId: thread.id,
				creatorId: modalSubmit.user.id,
			});
		} catch (error) {
			await thread.delete().catch(() => null);
			await message.delete().catch(() => null);
			throw error;
		}

		await modalSubmit.editReply({ embeds: [successEmbed(`${emojis.rightArrow2} Confession sent.`)] });
	}
}
