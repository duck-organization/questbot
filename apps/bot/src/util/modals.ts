// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { LabelBuilder, type MessageComponentInteraction, ModalBuilder, type TextInputBuilder } from 'discord.js';

export async function promptForModalInput(
	interaction: MessageComponentInteraction,
	customId: string,
	title: string,
	label: string,
	input: TextInputBuilder,
) {
	await interaction.showModal(
		new ModalBuilder()
			.setCustomId(customId)
			.setTitle(title)
			.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input)),
	);

	const submitted = await interaction
		.awaitModalSubmit({ filter: (m) => m.customId === customId && m.user.id === interaction.user.id, time: 120_000 })
		.catch(() => null);

	if (!submitted?.isFromMessage()) return null;

	await submitted.deferUpdate();

	return submitted;
}

export default promptForModalInput;
