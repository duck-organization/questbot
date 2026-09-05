// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { EmbedBuilder, Events, type Guild } from 'discord.js';
import { forgetAutoModRules } from '#lib/automod.js';
import { softDeleteServer } from '#lib/servers.js';
import { forgetSettings } from '#lib/settings.js';
import { forgetStickies } from '#lib/sticky.js';

export class GuildDeleteListener extends Listener<typeof Events.GuildDelete> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: Events.GuildDelete });
	}

	public async run(guild: Guild) {
		await softDeleteServer(guild.id);
		forgetSettings(guild.id);
		forgetAutoModRules(guild.id);
		forgetStickies(guild.id);

		const owner = await guild.client.users.fetch(guild.ownerId).catch(() => null);
		if (!owner) return;

		const embed = new EmbedBuilder()
			.setColor(0xffffff)
			.setTitle('Sorry to see you go!')
			.setDescription(
				`If you had any issues or have feedback, feel free to join the support server by using the \`/discord\` command.\n\nWe'd also appreciate it if you could fill out our feedback form at https://vantern.org/feedback/deletion. Thank you in advance!`,
			);

		await owner.send({ embeds: [embed] }).catch(() => null);
	}
}
