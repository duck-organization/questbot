// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ChatInputCommandSuccessPayload, Listener } from '@sapphire/framework';
import { getSticky, repostSticky } from '#lib/sticky.js';

// this file exists because discord doesn't send messageCreate for commands
export class StickyCommandListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: 'chatInputCommandSuccess' });
	}

	public override async run({ interaction }: ChatInputCommandSuccessPayload) {
		if (!interaction.inCachedGuild() || !interaction.channel) return;

		// discord fires this event for ephemeral commands, don't repost if so
		if (interaction.ephemeral !== false) return;

		const sticky = await getSticky(interaction.guildId, interaction.channel.id);
		if (!sticky) return;

		await repostSticky(interaction.channel, sticky);
	}
}
