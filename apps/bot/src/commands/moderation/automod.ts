// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type EmbedBuilder,
	type MessageComponentInteraction,
	MessageFlags,
	PermissionsBitField,
	type RepliableInteraction,
	type SlashCommandRoleOption,
	type SlashCommandStringOption,
	type SlashCommandSubcommandBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import {
	type AutoModRuleRow,
	autoModDescription,
	createLinksRule,
	createSpamRule,
	createWordRule,
	DuplicateAutoModRuleError,
	getAutoModRule,
	getAutoModRules,
	InvalidRegexError,
	removeAutoModRule,
} from '#lib/automod.js';
import { LimitError } from '#lib/limits.js';
import { getSettings, updateSettings } from '#lib/settings.js';
import { awaitMessageComponentSafe } from '#utils/collectors.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';
import { promptForModalInput } from '#utils/modals.js';

function timedOutEmbed() {
	return errorEmbed(`${emojis.rightArrow2} Timed out waiting for a response.\n-#Run the command again.`);
}

function cancelledEmbed() {
	return infoEmbed(`${emojis.rightArrow2} Cancelled.`);
}

async function promptForChoice(
	interaction: Command.ChatInputCommandInteraction<'cached'>,
	menu: StringSelectMenuBuilder,
	promptText: string,
) {
	const cancelButton = new ButtonBuilder()
		.setCustomId('automodCancel')
		.setLabel('Cancel')
		.setStyle(ButtonStyle.Secondary);

	const response = await interaction.reply({
		embeds: [infoEmbed(promptText)],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
			new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton),
		],
		flags: MessageFlags.Ephemeral,
		withResponse: true,
	});

	const choice = await awaitMessageComponentSafe(response.resource!.message!, {
		filter: (i: MessageComponentInteraction) => i.user.id === interaction.user.id,
		time: 60_000,
	});

	if (choice?.customId === 'automodCancel') {
		await choice.update({ embeds: [cancelledEmbed()], components: [] });
		return null;
	}

	if (!choice?.isStringSelectMenu()) {
		await interaction.editReply({ embeds: [timedOutEmbed()], components: [] });
		return null;
	}

	return choice;
}

export class AutoModCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('automod')
				.setDescription('Keep your server clean!')
				.setDefaultMemberPermissions(0)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('add')
						.setDescription('Create a new automod rule.')
						.addStringOption((option: SlashCommandStringOption) =>
							option
								.setName('rule')
								.setDescription('The type of rule to create')
								.setRequired(true)
								.addChoices(
									{ name: 'Word', value: 'WORD' },
									{ name: 'Spam', value: 'SPAM' },
									{ name: 'Links', value: 'LINKS' },
								),
						),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('remove')
						.setDescription('Remove an automod rule.')
						.addStringOption((option: SlashCommandStringOption) =>
							option
								.setName('rule')
								.setDescription('The rule to remove')
								.setAutocomplete(true)
								.setRequired(true)
								.setMaxLength(36),
						),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand.setName('list').setDescription('List all automod rules.'),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					subcommand
						.setName('exclusion')
						.setDescription('Exclude a role from all automod rules, or clear the current exclusion.')
						.addRoleOption((option: SlashCommandRoleOption) =>
							option.setName('role').setDescription('The role to exclude or the same role to clear').setRequired(false),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		if (!interaction.guildId) {
			await interaction.respond([]);
			return;
		}

		const focusedOption = interaction.options.getFocused(true);

		if (interaction.options.getSubcommand() !== 'remove' || focusedOption.name !== 'rule') {
			await interaction.respond([]);
			return;
		}

		const query = focusedOption.value.toString().trim().toLowerCase();
		const rules = await getAutoModRules(interaction.guildId);
		const matches = query ? rules.filter((rule) => autoModDescription(rule).toLowerCase().includes(query)) : rules;

		const choices = matches.slice(0, 25).map((rule) => ({
			name: autoModDescription(rule).slice(0, 100),
			value: rule.id,
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

		if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to manage automod.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'add') {
			await this.handleAdd(interaction);
			return;
		}

		if (subcommand === 'list') {
			await this.handleList(interaction);
			return;
		}

		if (subcommand === 'remove') {
			await this.handleRemove(interaction);
			return;
		}

		if (subcommand === 'exclusion') {
			await this.handleExclusion(interaction);
			return;
		}
	}

	// handling for adding rules (broad)
	private async handleAdd(interaction: Command.ChatInputCommandInteraction<'cached'>) {
		const rule = interaction.options.getString('rule', true) as 'WORD' | 'SPAM' | 'LINKS';

		if (rule === 'LINKS') {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			try {
				const created = await createLinksRule(interaction.guildId, interaction.guild.name);
				await this.ruleSuccess(interaction, created);
			} catch (err) {
				await this.ruleError(interaction, err);
			}
			return;
		}

		if (rule === 'WORD') {
			await this.handleAddWord(interaction);
			return;
		}

		await this.handleAddSpam(interaction);
	}

	// handling for adding word rules
	private async handleAddWord(interaction: Command.ChatInputCommandInteraction<'cached'>) {
		const methodMenu = new StringSelectMenuBuilder()
			.setCustomId('automodWordMethod')
			.setPlaceholder('Choose a filtering method')
			.addOptions(
				new StringSelectMenuOptionBuilder()
					.setLabel('Word')
					.setDescription('Block an exact word or phrase (recommended)')
					.setValue('WORD'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Regex')
					.setDescription('Block messages matching a regex pattern')
					.setValue('REGEX'),
			);

		const methodChoice = await promptForChoice(
			interaction,
			methodMenu,
			`${emojis.rightArrow1} Choose a filtering method for this word rule:`,
		);

		if (!methodChoice) return;

		const method = methodChoice.values[0] as 'WORD' | 'REGEX';

		const submitted = await promptForModalInput(
			methodChoice,
			'automodWordPatternModal',
			method === 'REGEX' ? 'Regex Pattern' : 'Blocked Word',
			method === 'REGEX' ? 'Which regex pattern should be blocked?' : 'Which word or phrase should be blocked?',
			new TextInputBuilder()
				.setCustomId('value')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setMaxLength(100)
				.setPlaceholder(method === 'REGEX' ? 'regex pattern' : 'badword'),
		);

		if (!submitted) {
			await interaction.editReply({ embeds: [timedOutEmbed()], components: [] });
			return;
		}

		const pattern = submitted.fields.getTextInputValue('value').trim();

		if (!pattern) {
			await submitted.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That can't be empty, try again.`)],
				components: [],
			});
			return;
		}

		try {
			const created = await createWordRule(
				interaction.guildId,
				interaction.guild.name,
				method,
				method === 'WORD' ? pattern.toLowerCase() : pattern,
			);
			await this.ruleSuccess(submitted, created);
		} catch (err) {
			await this.ruleError(submitted, err);
		}
	}

	// handling for adding spam rules
	private async handleAddSpam(interaction: Command.ChatInputCommandInteraction<'cached'>) {
		const rangeMenu = new StringSelectMenuBuilder()
			.setCustomId('automodSpamRange')
			.setPlaceholder('Choose a range')
			.addOptions(
				new StringSelectMenuOptionBuilder()
					.setLabel('All Channels')
					.setDescription('Count messages across all channels')
					.setValue('ALL_CHANNELS'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Per Channel')
					.setDescription('Only count messages within a single channel')
					.setValue('PER_CHANNEL'),
			);

		const rangeChoice = await promptForChoice(
			interaction,
			rangeMenu,
			`${emojis.rightArrow1} Choose a range for this spam rule:`,
		);

		if (!rangeChoice) return;

		const range = rangeChoice.values[0] as 'ALL_CHANNELS' | 'PER_CHANNEL';

		const submitted = await promptForModalInput(
			rangeChoice,
			'automodSpamThresholdModal',
			'Message Threshold',
			'How many messages every 5s triggers this?',
			new TextInputBuilder()
				.setCustomId('value')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setMaxLength(2)
				.setPlaceholder('3-10'),
		);

		if (!submitted) {
			await interaction.editReply({ embeds: [timedOutEmbed()], components: [] });
			return;
		}

		const threshold = Number(submitted.fields.getTextInputValue('value').trim());

		if (!Number.isInteger(threshold) || threshold < 3 || threshold > 10) {
			await submitted.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That needs to be a whole number between 3 and 10, try again.`)],
				components: [],
			});
			return;
		}

		try {
			const created = await createSpamRule(interaction.guildId, interaction.guild.name, range, threshold);
			await this.ruleSuccess(submitted, created);
		} catch (err) {
			await this.ruleError(submitted, err);
		}
	}

	private async sendResult(interaction: RepliableInteraction, embed: EmbedBuilder) {
		const payload = { embeds: [embed], components: [] };

		if (interaction.deferred || interaction.replied) {
			await interaction.editReply(payload);
		} else {
			await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
		}
	}

	private async ruleSuccess(interaction: RepliableInteraction, rule: AutoModRuleRow) {
		const description = autoModDescription(rule);
		await this.sendResult(
			interaction,
			successEmbed(`${emojis.rightArrow2} Automod will now **${description[0].toLowerCase()}${description.slice(1)}**`), // we store the rule descriptions with a capital char so we just remove it here, looks better
		);
	}

	private async ruleError(interaction: RepliableInteraction, err: unknown) {
		if (err instanceof LimitError || err instanceof DuplicateAutoModRuleError || err instanceof InvalidRegexError) {
			await this.sendResult(interaction, errorEmbed(`${emojis.rightArrow2} ${err.message}`));
			return;
		}

		console.error(err);
		await this.sendResult(interaction, errorEmbed(`${emojis.rightArrow2} Failed to add that automod rule.`));
	}

	private async handleList(interaction: Command.ChatInputCommandInteraction<'cached'>) {
		const [rules, settings] = await Promise.all([
			getAutoModRules(interaction.guildId),
			getSettings(interaction.guildId),
		]);

		const exclusionLine = settings.automodExemptRoleId
			? `${emojis.rightArrow1} **Exclusion role:** <@&${settings.automodExemptRoleId}>\n\n`
			: '';

		if (rules.length === 0) {
			await interaction.reply({
				embeds: [
					infoEmbed(`${exclusionLine}${emojis.rightArrow2} No automod rules yet, add one with \`/automod add\`!`),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const totalPages = Math.ceil(rules.length / 5);
		let page = 0;

		const buildEmbed = (page: number) => {
			const slice = rules.slice(page * 5, (page + 1) * 5);
			const ruleList = slice.map((rule) => `${emojis.rightArrow1} ${autoModDescription(rule)}`).join('\n');
			const embed = infoEmbed(`${exclusionLine}${ruleList}`).setTitle('Automod Rules');
			return totalPages > 1 ? embed.setFooter({ text: `Page ${page + 1} of ${totalPages}` }) : embed;
		};

		const buildRow = (page: number) =>
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId('prev')
					.setEmoji('◀')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page === 0),
				new ButtonBuilder()
					.setCustomId('next')
					.setEmoji('▶')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page >= totalPages - 1),
			);

		if (totalPages === 1) {
			await interaction.reply({ embeds: [buildEmbed(0)], flags: MessageFlags.Ephemeral });
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

			await btn.update({ embeds: [buildEmbed(page)], components: [buildRow(page)] });
		}
	}

	// handling for removing rules (broad)
	private async handleRemove(interaction: Command.ChatInputCommandInteraction<'cached'>) {
		const ruleId = interaction.options.getString('rule', true);
		const rule = await getAutoModRule(ruleId);

		if (!rule || rule.guildId !== interaction.guildId) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} That automod rule doesn't exist.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await removeAutoModRule(rule.id);
		const description = autoModDescription(rule);
		await interaction.reply({
			embeds: [
				successEmbed(
					`${emojis.rightArrow2} Automod will no longer **${description[0].toLowerCase()}${description.slice(1)}**`, // we store the rule descriptions with a capital char so we just remove it here, looks better
				),
			],
			flags: MessageFlags.Ephemeral,
		});
	}

	// handling for the exclusion role
	private async handleExclusion(interaction: Command.ChatInputCommandInteraction<'cached'>) {
		const role = interaction.options.getRole('role');
		const settings = await getSettings(interaction.guildId);

		if (!role) {
			if (!settings.automodExemptRoleId) {
				await interaction.reply({
					embeds: [infoEmbed(`${emojis.rightArrow2} There is no automod exclusion role set.`)],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			await updateSettings(interaction.guildId, interaction.guild.name, { automodExemptRoleId: null });
			await interaction.reply({
				embeds: [successEmbed(`${emojis.rightArrow2} Automod exclusion role cleared.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const clearing = settings.automodExemptRoleId === role.id; // aka is the role inputted the same if so then we clear
		await updateSettings(interaction.guildId, interaction.guild.name, {
			automodExemptRoleId: clearing ? null : role.id,
		});

		await interaction.reply({
			embeds: [
				successEmbed(
					`${emojis.rightArrow2} <@&${role.id}> is ${clearing ? 'no longer excluded from automod' : 'now excluded from all automod rules'}.`,
				),
			],
			flags: MessageFlags.Ephemeral,
		});
	}
}
