// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type AuditLogEvent, EmbedBuilder, type Guild, type User } from 'discord.js';
import { getSettings, SETTING_LABELS, type ServerSettings } from '#lib/settings.js';

// so we don't return the raw value (looks ugly)
function formatSetting(key: keyof ServerSettings, value: ServerSettings[keyof ServerSettings]): string {
	if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
	if (value === null || value === undefined) return 'None';
	if (key.endsWith('ChannelId') || key.endsWith('CategoryId')) return `<#${value}>`;
	if (key.endsWith('Role')) return `<@&${value}>`;

	return String(value);
}

async function sendLog(guild: Guild, channelId: string, embed: EmbedBuilder) {
	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased() || !channel.isSendable()) return;

	await channel.send({ embeds: [embed] }).catch((err) => console.error(err));
}

export async function logEmbed(guild: Guild, embed: EmbedBuilder) {
	const settings = await getSettings(guild.id).catch((err) => {
		console.error(err);
		return null;
	});

	if (!settings?.loggingEnabled || !settings.loggingChannelId) return;

	await sendLog(guild, settings.loggingChannelId, embed);
}

// used in settings.ts for all changes
export async function logSettingsChange(guild: Guild, user: User, before: ServerSettings, after: ServerSettings) {
	const finalChannelId = before.loggingEnabled && !after.loggingEnabled ? before.loggingChannelId : null; // aka it was just disabled

	for (const key of Object.keys(SETTING_LABELS) as (keyof ServerSettings)[]) {
		if (before[key] === after[key]) continue;

		const { category, name } = SETTING_LABELS[key];

		const embed = new EmbedBuilder()
			.setTitle('Setting Updated')
			.setColor(0xfac898)
			.addFields(
				// \u200b is a messy hack allowing for 2x2 format, discord is annoying.
				{ name: 'Category', value: category, inline: true },
				{ name: 'Setting', value: name, inline: true },
				{ name: '\u200b', value: '\u200b', inline: true },
				{ name: 'Before', value: formatSetting(key, before[key]), inline: true },
				{ name: 'After', value: formatSetting(key, after[key]), inline: true },
				{ name: '\u200b', value: '\u200b', inline: true },
				{ name: 'Moderator', value: `<@${user.id}>`, inline: false },
			)
			.setTimestamp();

		if (finalChannelId) await sendLog(guild, finalChannelId, embed);
		else await logEmbed(guild, embed);
	}
}

export async function isLoggingChannel(guild: Guild, channelId: string | null | undefined) {
	if (!channelId) return false;

	const settings = await getSettings(guild.id).catch((err) => {
		console.error(err);
		return null;
	});

	return settings?.loggingEnabled && settings.loggingChannelId === channelId;
}

export async function getRecentAuditLogEntry(guild: Guild, type: AuditLogEvent, targetId: string) {
	const auditLogs = await guild.fetchAuditLogs({ type, limit: 5 }).catch((err) => {
		if (err?.code !== 10004) console.error(err);
		return null;
	});

	if (!auditLogs) return null;

	return (
		auditLogs.entries.find((entry) => entry.targetId === targetId && Date.now() - entry.createdTimestamp < 5_000) ??
		null
	);
}

export function truncate(text: string | null | undefined, length = 1024): string {
	if (!text) return '';
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
