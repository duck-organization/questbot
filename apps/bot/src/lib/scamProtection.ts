// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmbedBuilder, type Message } from 'discord.js';
import { applyBan } from '#lib/bans.js';
import { BurstTracker } from '#lib/burstTracker.js';
import { logEmbed } from '#lib/logging.js';
import type { ServerSettings } from '#lib/settings.js';

export const SCAM_ACTIONS = {
	// also used in settings.ts
	delete: 'Delete messages',
	kickDelete: 'Kick + delete messages',
	banDelete: 'Ban + delete messages',
} as const;

export type ScamAction = keyof typeof SCAM_ACTIONS;

const recentMessages = new BurstTracker(4_000);

export async function enforceScamProtection(message: Message, settings: ServerSettings): Promise<boolean> {
	if (!settings.scamProtectionEnabled || message.author.bot || !message.inGuild()) return false;

	// exempt (role) members aren't tracked
	if (settings.scamProtectionExemptionRole && message.member?.roles.cache.has(settings.scamProtectionExemptionRole))
		return false;

	const key = `${message.guildId}:${message.author.id}`;
	const burst = recentMessages.record(key, {
		channelId: message.channelId,
		messageId: message.id,
		sentAt: Date.now(),
	});
	const channelIds = new Set(burst.map((entry) => entry.channelId));

	if (channelIds.size < 3) {
		// requirement of it being across 3 channels
		return false;
	}

	recentMessages.clear(key);

	const guild = message.guild;

	for (const entry of burst) {
		const channel = guild.channels.cache.get(entry.channelId);
		if (channel?.isTextBased()) await channel.messages.delete(entry.messageId).catch(() => {});
	}

	const REASON = `Scam protection is enabled and ${message.author.tag} posted 3 messages across 3 channels within 4 seconds.`;
	if (settings.scamProtectionAction === 'kickDelete' && message.member?.kickable) {
		await message.member.kick(REASON).catch((err) => console.error(err));
	} else if (settings.scamProtectionAction === 'banDelete') {
		await applyBan(guild, message.author.id, REASON);
	}

	const embed = new EmbedBuilder()
		.setTitle('Scam Protection')
		.setColor(0xff6962)
		.addFields(
			{ name: 'Member', value: `${message.author.tag} (${message.author.id})`, inline: false },
			{ name: 'Channels', value: [...channelIds].map((id) => `<#${id}>`).join(', '), inline: false },
			{ name: 'Action', value: SCAM_ACTIONS[settings.scamProtectionAction], inline: true },
		)
		.setTimestamp();

	await logEmbed(guild, embed);

	return true;
}
