// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type MessageComponentInteraction,
	MessageFlags,
} from 'discord.js';
import { logger } from '#lib/logger.js';
import { emojis } from '#utils/emoji.js';

const CMDS_PAGE = 5; // amount of cmds displayed per page

function buildHelpPage(lines: string[], page: number) {
	const pageCount = Math.ceil(lines.length / CMDS_PAGE);
	const start = page * CMDS_PAGE;

	const embed = new EmbedBuilder()
		.setTitle('Commands')
		.setDescription(lines.slice(start, start + CMDS_PAGE).join('\n'))
		// links will always be below each page, they also don't change
		.addFields({
			name: 'Links',
			value:
				'Status: https://status.vantern.org/\nOfficial Discord Server: https://discord.gg/F4HYE8frK2\nDocumentation: https://docs.vantern.org/',
		});

	if (pageCount > 1) embed.setFooter({ text: `Page ${page + 1} of ${pageCount}` });

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('helpPrev')
			.setEmoji('◀') //* this looks weird but it is renders as an arrow emoji... discord LOVES unicode.
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page === 0),
		new ButtonBuilder()
			.setCustomId('helpNext')
			.setEmoji('▶') // same as above ^
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page === pageCount - 1),
	);

	return { embeds: [embed], components: pageCount > 1 ? [row] : [] };
}

export class HelpCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder.setName('help').setDescription('View the bots commands and links to resources.'),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const commands = this.container.stores.get('commands');

		const lines = Array.from(commands.values())
			.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
			.map((cmd) => {
				// biome-ignore lint/complexity/useLiteralKeys: x
				const description = cmd.applicationCommandRegistry['apiCalls'][0]?.builtData.description ?? cmd.description;
				// biome-ignore lint/complexity/useLiteralKeys: x
				const commandName = cmd.applicationCommandRegistry['apiCalls'][0]?.builtData.name ?? cmd.name;

				return `${emojis.rightArrow1} \`/${commandName}\` - ${description}`;
			});

		const response = await interaction.reply({
			...buildHelpPage(lines, 0),
			flags: MessageFlags.Ephemeral, // ephemeral unlike some bots that scream all of their commands in chat
			withResponse: true,
		});

		if (lines.length <= CMDS_PAGE) return;

		let page = 0;

		const collector = response.resource!.message!.createMessageComponentCollector({
			filter: (i: MessageComponentInteraction) => i.user.id === interaction.user.id,
			time: 120_000, // 2m, normally 1m but people will be reading help longer if not browsing
		});

		collector.on('collect', async (i) => {
			page += i.customId === 'helpNext' ? 1 : -1;

			try {
				await i.update(buildHelpPage(lines, page));
			} catch (error) {
				logger.debug('failed to update help page', error); //* really we should never hit this but if we do, the console can enjoy it
			}
		});

		collector.on('end', async () => {
			try {
				await interaction.editReply({ components: [] });
			} catch (error) {
				logger.debug('failed to clear help components', error); // same goes for this, see above ^
			}
		});
	}
}
