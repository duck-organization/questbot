// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { Events, type Message } from 'discord.js';
import { containsBlockedWord, enforceAutoMod } from '#lib/automod.js';
import { autoPublish } from '#lib/autoPublisher.js';
import { isHaiku } from '#lib/haiku.js';
import { enforceHoneypot } from '#lib/honeypot.js';
import { enforceScamProtection } from '#lib/scamProtection.js';
import { getSettings } from '#lib/settings.js';

export class MessageCreateListener extends Listener<typeof Events.MessageCreate> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			event: Events.MessageCreate,
		});
	}

	public async run(message: Message) {
		if (!message.guild) return;

		// by doing this you ALLOW it to reply to bots haiku's such as ai bots writing one :D
		const content = message.content.toLowerCase();
		const settings = await getSettings(message.guild.id);

		// nothing below will trigger as the message gets deleted
		if (await enforceHoneypot(message, settings)) return;
		if (await enforceScamProtection(message, settings)) return;

		if (settings.haikuEnabled && isHaiku(message.content)) {
			await message.reply("That's a haiku!").catch((err) => console.error(err));
		}

		if (await enforceAutoMod(message, settings)) return;

		if (settings.autoPublisher) {
			const blockedAsBot = message.author.bot && (await containsBlockedWord(message.guild.id, message.content));
			if (!blockedAsBot) await autoPublish(message);
		}

		if (message.author.bot) return;

		const moderatorIds = [
			...new Set(
				(process.env.MODERATORS ?? '')
					.split(',')
					.map((id) => id.trim())
					.filter(Boolean),
			),
		];

		if (moderatorIds.includes(message.author.id)) {
			if (content.includes('<@1494686224508522579>')) {
				// acts as a way to check if someone is a bot moderator
				await message.reply('Why hello there!').catch((err) => console.error(err));
			}
		}
	}
}
