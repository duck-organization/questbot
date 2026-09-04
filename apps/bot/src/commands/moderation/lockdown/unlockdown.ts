// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BucketScope, Command } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isServerLocked, unLockdown } from '#lib/lockdown.js';
import { logger } from '#lib/logger.js';
import { logEmbed } from '#lib/logging.js';
import { errorEmbed, infoEmbed, successEmbed } from '#utils/embeds.js';
import { emojis } from '#utils/emoji.js';

export class UnlockdownCommand extends Command {
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
				.setName('unlockdown')
				.setDescription('Unlock the whole server.')
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
				embeds: [errorEmbed(`${emojis.rightArrow2} You do not have permission to unlock the server.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!(await isServerLocked(interaction.guildId))) {
			await interaction.reply({
				embeds: [infoEmbed(`${emojis.rightArrow2} The server is not locked down.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const { affected, skipped } = await unLockdown(interaction.guild, `Lockdown removed by ${interaction.user.tag}`);

			const logEntry = new EmbedBuilder()
				.setTitle('Server Unlocked')
				.setColor(0x77dd76)
				.addFields(
					{ name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
					{ name: 'Unlocked', value: String(affected), inline: true },
					{ name: 'Skipped', value: String(skipped), inline: true },
				)
				.setTimestamp();

			await logEmbed(interaction.guild, logEntry);

			await interaction.editReply({
				embeds: [
					successEmbed(
						`${emojis.rightArrow1} Unlocked ${affected} channel${affected === 1 ? '' : 's'}.${skipped ? `\nSkipped ${skipped} I could not unlock.` : ''}`,
					),
				],
			});
		} catch (error) {
			logger.error(error);
			await interaction.editReply({
				embeds: [errorEmbed(`${emojis.rightArrow2} Failed to unlock the server.`)],
			});
		}
	}
}
