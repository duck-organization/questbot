// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import { AttachmentBuilder, type SlashCommandAttachmentOption, type SlashCommandStringOption } from 'discord.js';
import sharp from 'sharp';
import { readLimited, SafeFetchError, safeFetch } from '#lib/safeFetch.js';
import { errorEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

// todo: add video support (mp4, webm, mov)

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_SIZE = 8 * 1024 * 1024;
const MAX_DIMENSION = 800;

export class ToGifCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('togif')
				.setDescription('Convert a PNG, JPEG, or WEBP image to a GIF.')
				.addStringOption((option: SlashCommandStringOption) =>
					option.setName('url').setDescription('The image URL to convert.').setMaxLength(512),
				)
				.addAttachmentOption((option: SlashCommandAttachmentOption) =>
					option.setName('file').setDescription('The image file to convert.'),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const url = interaction.options.getString('url');
		const file = interaction.options.getAttachment('file');

		if (!url && !file) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow1} Provide either an image URL or a file to convert.`)],
				ephemeral: true,
			});
			return;
		}

		if (url && file) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow1} Provide either an image URL or file, not both.`)],
				ephemeral: true,
			});
			return;
		}

		await interaction.deferReply();

		const sourceUrl = file ? file.url : url!;

		let response: Response;
		try {
			response = await safeFetch(sourceUrl);
		} catch (err) {
			const msg = err instanceof SafeFetchError ? err.message : `Failed to fetch the ${file ? 'file' : 'URL'}.`;
			await interaction.editReply({ embeds: [errorEmbed(`${emojis.rightArrow1} ${msg}`)] });
			return;
		}

		if (!response.ok) {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow1} Could not retrieve the image (HTTP ${response.status}).`)],
			});
			return;
		}

		const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
		if (!ALLOWED_TYPES.has(contentType)) {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow1} Only PNG, JPEG, and WEBP images are supported.`)],
			});
			return;
		}

		const contentLength = response.headers.get('content-length');
		if (contentLength && parseInt(contentLength, 10) > MAX_SIZE) {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow1} Image exceeds the 8 MB size limit.`)],
			});
			return;
		}

		let inputBuffer: Buffer;
		try {
			inputBuffer = await readLimited(response, MAX_SIZE);
		} catch {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow1} Image exceeds the 8 MB size limit.`)],
			});
			return;
		}

		let gifBuffer: Buffer;
		try {
			gifBuffer = await sharp(inputBuffer, { failOn: 'error' })
				.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
				.gif()
				.toBuffer();
		} catch {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow1} Failed to convert the image to GIF.`)],
			});
			return;
		}

		const attachment = new AttachmentBuilder(gifBuffer, { name: 'toGif.gif' });
		await interaction.editReply({ files: [attachment] });
	}
}
