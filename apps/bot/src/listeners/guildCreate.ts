// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { AuditLogEvent, EmbedBuilder, Events, type Guild, PermissionFlagsBits } from 'discord.js';
import { restoreServer } from '#lib/servers.js';

export class GuildCreateListener extends Listener<typeof Events.GuildCreate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.GuildCreate });
	}

	public async run(guild: Guild) {
		await restoreServer(guild.id);

		if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

		const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 }).catch(() => null);
		const entry = logs?.entries.find((e) => e.target?.id === guild.client.user.id);
		const adder = entry?.executor;

		if (!adder) return;

		const embed = new EmbedBuilder()
			.setColor(0xffffff)
			.setTitle('Thanks for adding me!')
			.setDescription(
				`I'm here to replace your other bot's and help improve your server!\n\nTo get started you can use the \`/setup\` command to help configure your server.\nIf you know how I work and want to configure me you can run \`/help\` for a list of all commands.\n\nIf you have any questions or need help, feel free to join the support server by using the \`/discord\` command.`,
			);

		await adder.send({ embeds: [embed] }).catch(() => null);
	}
}
