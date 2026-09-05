// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Command } from '@sapphire/framework';
import {
	EmbedBuilder,
	type GuildMember,
	type SlashCommandBooleanOption,
	type SlashCommandBuilder,
	type SlashCommandSubcommandBuilder,
	type SlashCommandUserOption,
	type User,
} from 'discord.js';
import { Colors, errorEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';
import { ASSET_SIZE, assetMessage, replyWithAsset, toUnix } from '#utils/profile.js';

function addUserOption(subcommand: SlashCommandSubcommandBuilder, description: string): SlashCommandSubcommandBuilder {
	return subcommand.addUserOption((option: SlashCommandUserOption) =>
		option.setName('user').setDescription(description).setRequired(false),
	);
}

function formatRoles(member: GuildMember): string {
	const roles = member.roles.cache
		.filter((role) => role.id !== member.guild.id)
		.sorted((a, b) => b.position - a.position);

	if (roles.size === 0) return 'None';

	const shown = [...roles.values()].slice(0, 15).map((role) => role.toString());
	const remaining = roles.size - shown.length;

	return remaining > 0 ? `${shown.join(' ')} +${remaining} more` : shown.join(' ');
}

export class UserCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, { ...options, preconditions: ['devMode'] });
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder: SlashCommandBuilder) =>
			builder
				.setName('user')
				.setDescription("View a user's profile picture, banner, or info.")
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					addUserOption(
						subcommand.setName('pfp').setDescription("Easily download or view your own or someone else's pfp."),
						'The user whose profile picture you want to view',
					).addBooleanOption((option: SlashCommandBooleanOption) =>
						option
							.setName('global')
							.setDescription('Whether to view the global version of the profile picture')
							.setRequired(false),
					),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					addUserOption(
						subcommand.setName('banner').setDescription("Easily download or view your own or someone else's banner."),
						'The user whose banner you want to view',
					),
				)
				.addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
					addUserOption(
						subcommand.setName('info').setDescription('View information about yourself or someone else.'),
						'The user whose info you want to view',
					),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();

		const subcommand = interaction.options.getSubcommand();
		const user = interaction.options.getUser('user') ?? interaction.user;

		if (subcommand === 'pfp') {
			await this.sendPfp(interaction, user);
			return;
		}

		if (subcommand === 'banner') {
			await this.sendBanner(interaction, user);
			return;
		}

		if (subcommand === 'info') {
			await this.sendInfo(interaction, user);
			return;
		}
	}

	private async sendPfp(interaction: Command.ChatInputCommandInteraction, user: User) {
		const global = interaction.options.getBoolean('global') ?? false;

		const member =
			!global && interaction.inCachedGuild() ? (interaction.options.getMember('user') ?? interaction.member) : null;

		const avatarUrl = (member ?? user).displayAvatarURL({ size: ASSET_SIZE });

		await interaction.editReply(assetMessage(user.displayName, user.id, avatarUrl));
	}

	private async sendBanner(interaction: Command.ChatInputCommandInteraction, user: User) {
		const fetched = await user.fetch(true).catch(() => null);

		if (!fetched) {
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Couldn't fetch that user, please try again.`)],
			});
			return;
		}

		const bannerUrl = fetched.bannerURL({ size: ASSET_SIZE });

		await replyWithAsset(
			interaction,
			fetched.displayName,
			fetched.id,
			bannerUrl,
			`**${fetched.displayName}** doesn't have a banner!`,
		);
	}

	private async sendInfo(interaction: Command.ChatInputCommandInteraction, user: User) {
		const member = interaction.inCachedGuild()
			? await interaction.guild.members.fetch(user.id).catch(() => null)
			: null;

		const created = toUnix(user.createdTimestamp);
		const lines = [
			`${emojis.rightArrow1} **Username:** ${user.username}${user.bot ? ' (bot)' : ''}`,
			`${emojis.rightArrow1} **Created:** <t:${created}:D> (<t:${created}:R>)`,
		];

		if (member?.nickname) {
			lines.push(`${emojis.rightArrow1} **Nickname:** ${member.nickname}`);
		}

		if (member?.joinedTimestamp) {
			const joined = toUnix(member.joinedTimestamp);
			lines.push(`${emojis.rightArrow1} **Joined:** <t:${joined}:D> (<t:${joined}:R>)`);
		}

		if (member) {
			lines.push(`${emojis.rightArrow1} **Roles:**\n${formatRoles(member)}`);
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.info)
			.setTitle(`${user.displayName}`)
			.setThumbnail(user.displayAvatarURL({ size: ASSET_SIZE }))
			.setDescription(lines.join('\n'))
			.setFooter({ text: `ID: ${user.id}` });

		await interaction.editReply({ embeds: [embed] });
	}
}
