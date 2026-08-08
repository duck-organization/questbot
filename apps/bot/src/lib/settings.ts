// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Prisma, prisma } from '@questbot/database';
import type { ScamAction } from './scamProtection.js';

export type ServerSettings = {
	welcomePeople: boolean;
	welcomeChannelId: string | null;
	ticketCategoryId: string | null;
	ticketTranscriptChannelId?: string | null;
	staffRole: string | null;
	confessionChannelId: string | null;
	confessionEnabled: boolean;
	loggingEnabled?: boolean;
	loggingChannelId?: string | null;
	haikuEnabled?: boolean;
	autoPublisher?: boolean;
	starboardEnable?: boolean;
	starboardChannelId?: string | null;
	starboardRequirement: number;
	starboardEmoji: string;
	scamProtectionEnabled: boolean;
	scamProtectionAction: ScamAction;
	scamProtectionExemptionRole: string | null;
	honeypotChannelId: string | null;
};

export const DefaultSettings: ServerSettings = {
	welcomePeople: false,
	welcomeChannelId: null,
	ticketCategoryId: null,
	ticketTranscriptChannelId: null,
	staffRole: null,
	confessionChannelId: null,
	confessionEnabled: false,
	loggingEnabled: false,
	loggingChannelId: null,
	haikuEnabled: false,
	autoPublisher: false,
	starboardEnable: false,
	starboardChannelId: null,
	starboardRequirement: 3,
	starboardEmoji: '⭐️',
	scamProtectionEnabled: false,
	scamProtectionAction: 'delete',
	scamProtectionExemptionRole: null,
	honeypotChannelId: null,
};

// used for logging setting changes
// update: originally was done as only the setting name, now also contains category
export const SETTING_LABELS: Record<keyof ServerSettings, { category: string; name: string }> = {
	welcomePeople: { category: 'Welcome', name: 'Status' },
	welcomeChannelId: { category: 'Welcome', name: 'Channel' },

	ticketCategoryId: { category: 'Tickets', name: 'Category' },
	ticketTranscriptChannelId: { category: 'Tickets', name: 'Transcript Channel' },
	staffRole: { category: 'Tickets', name: 'Staff Role' },

	confessionChannelId: { category: 'Confessions', name: 'Channel' },
	confessionEnabled: { category: 'Confessions', name: 'Status' },

	loggingEnabled: { category: 'Logging', name: 'Status' },
	loggingChannelId: { category: 'Logging', name: 'Channel' },

	haikuEnabled: { category: 'Haiku', name: 'Status' },

	autoPublisher: { category: 'Auto Publisher', name: 'Status' },

	starboardEnable: { category: 'Starboard', name: 'Status' },
	starboardChannelId: { category: 'Starboard', name: 'Channel' },
	starboardRequirement: { category: 'Starboard', name: 'Reactions Required' },
	starboardEmoji: { category: 'Starboard', name: 'Emoji' },

	scamProtectionEnabled: { category: 'Scam Protection', name: 'Status' },
	scamProtectionAction: { category: 'Scam Protection', name: 'Action' },
	scamProtectionExemptionRole: { category: 'Scam Protection', name: 'Exemption Role' },
	
	honeypotChannelId: { category: 'Honey Pot', name: 'Channel' },
};

// caching rather than ending up fetching the settings basically each message
const settingsCache = new Map<string, { settings: ServerSettings; expiresAt: number }>();

async function readSettings(guildId: string): Promise<ServerSettings> {
	const row = await prisma.server.findUnique({
		where: { id: guildId },
		select: { settings: true },
	});

	return { ...DefaultSettings, ...((row?.settings ?? {}) as Partial<ServerSettings>) };
}

export async function getSettings(guildId: string): Promise<ServerSettings> {
	const cached = settingsCache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) return cached.settings;

	const settings = await readSettings(guildId);
	settingsCache.set(guildId, { settings, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 min ttl

	return settings;
}

export async function updateSettings(
	guildId: string,
	guildName: string,
	patch: Partial<ServerSettings>,
): Promise<ServerSettings> {
	const current = await readSettings(guildId);
	const next = { ...current, ...patch };

	await prisma.server.upsert({
		where: { id: guildId },
		create: { id: guildId, name: guildName, settings: next as Prisma.InputJsonValue },
		update: { name: guildName, settings: next as Prisma.InputJsonValue },
	});

	settingsCache.set(guildId, { settings: next, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 min ttl

	return next;
}

export function forgetSettings(guildId: string): void {
	settingsCache.delete(guildId);
}
