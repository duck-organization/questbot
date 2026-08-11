// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BucketScope, Command } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isServerLocked, lockdownServer } from '#lib/lockdown.js';
import { logEmbed } from '#lib/logging.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class LockdownCommand extends Command {
	public constructor(context: Command.LoaderContext, options: Command.Options) {
		super(context, {
			...options,
			preconditions: ['devMode'],
			cooldownDelay: 30_000,
			cooldownLimit: 1,
			cooldownScope: BucketScope.Guild,
		});
	}

	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('lockdown')
				.setDescription('Lock down all channels in the server, preventing everyone from speaking.')
				.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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

		if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
			await interaction.reply({
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to lock down the server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (await isServerLocked(interaction.guildId)) {
			await interaction.reply({
				embeds: [infoEmbed(`${emojis.rightArrow2} The server is already locked down.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// defer as we are about to change all channels perms
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const { affected, skipped } = await lockdownServer(interaction.guild, `Lockdown by ${interaction.user.tag}`);

			const logEntry = new EmbedBuilder()
				.setTitle('Server Locked')
				.setColor(0x000000)
				.addFields(
					{ name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
					{ name: 'Locked', value: String(affected), inline: true },
					{ name: 'Skipped', value: String(skipped), inline: true },
				)
				.setTimestamp();

			await logEmbed(interaction.guild, logEntry);

			await interaction.editReply({
				embeds: [
					successEmbed(
						`${emojis.rightArrow1} Locked ${affected} channel${affected === 1 ? '' : 's'}.${skipped ? `\nSkipped ${skipped} I could not lock.` : ''}`,
					),
				],
			});
		} catch (error) {
			console.error(error);
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Failed to lock down this server.`)],
			});
		}
	}
}
