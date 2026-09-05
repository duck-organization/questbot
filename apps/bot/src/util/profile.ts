// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
	EmbedBuilder,
} from 'discord.js';
import { Colors, errorEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export const ASSET_SIZE = 4096; //* global size for fetching an asset from a user or server

export interface AssetMessage {
	embeds: EmbedBuilder[];
	components: ActionRowBuilder<ButtonBuilder>[];
}

export function toUnix(timestamp: number): number {
	return Math.floor(timestamp / 1000);
}

export function assetMessage(name: string, id: string, url: string): AssetMessage {
	const embed = new EmbedBuilder()
		.setColor(Colors.info)
		.setTitle(name)
		.setImage(url)
		.setFooter({ text: `ID: ${id}` });

	const downloadRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setLabel('Download').setStyle(ButtonStyle.Link).setURL(url),
	);

	return { embeds: [embed], components: [downloadRow] };
}

export async function replyWithAsset(
	interaction: ChatInputCommandInteraction,
	name: string,
	id: string,
	url: string | null | undefined,
	missingText: string,
): Promise<void> {
	if (!url) {
		await interaction.editReply({ embeds: [errorEmbed(`${emojis.rightArrow2} ${missingText}`)] });
		return;
	}

	await interaction.editReply(assetMessage(name, id, url));
}
