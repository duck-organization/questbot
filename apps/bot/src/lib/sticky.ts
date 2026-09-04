// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Prisma, prisma } from '@questbot/database';
import type { GuildTextBasedChannel } from 'discord.js';
import { logger } from '#lib/logger.js';

export type Sticky = Prisma.ChannelModel;

//* checked on every message so we cache it per guild (same as automod)
const stickyCache = new Map<string, { stickies: Sticky[]; expiresAt: number }>();

const lastRepostAt = new Map<string, number>();
const pendingRepost = new Set<string>();

async function getGuildStickies(guildId: string): Promise<Sticky[]> {
	const cached = stickyCache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) return cached.stickies;

	const stickies = await prisma.channel.findMany({
		where: { guildId, stickyContent: { not: null } },
	});

	stickyCache.set(guildId, { stickies, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 min ttl

	return stickies;
}

export async function getSticky(guildId: string, channelId: string): Promise<Sticky | null> {
	const stickies = await getGuildStickies(guildId);

	return stickies.find((sticky) => sticky.id === channelId) ?? null;
}

export function forgetStickies(guildId: string): void {
	const cached = stickyCache.get(guildId);
	if (cached) {
		for (const sticky of cached.stickies) {
			lastRepostAt.delete(sticky.id);
			pendingRepost.delete(sticky.id);
		}
	}
	stickyCache.delete(guildId);
}

export async function setSticky(guildId: string, guildName: string, channelId: string, content: string) {
	await prisma.server.upsert({
		where: { id: guildId },
		create: { id: guildId, name: guildName },
		update: { name: guildName },
	});

	const sticky = await prisma.channel.upsert({
		where: { id: channelId },
		create: { id: channelId, guildId, stickyContent: content },
		update: { stickyContent: content },
	});
	stickyCache.delete(guildId);

	return sticky;
}

export async function removeSticky(guildId: string, channelId: string): Promise<boolean> {
	const { count } = await prisma.channel.updateMany({
		where: { id: channelId, stickyContent: { not: null } },
		data: { stickyContent: null, stickyMessageId: null },
	});
	lastRepostAt.delete(channelId);
	pendingRepost.delete(channelId);
	stickyCache.delete(guildId);

	return count > 0;
}

export async function repostSticky(channel: GuildTextBasedChannel, sticky: Sticky, force = false): Promise<void> {
	if (!sticky.stickyContent || !channel.isSendable()) return;

	const since = Date.now() - (lastRepostAt.get(channel.id) ?? 0);

	// when a new message is sent while on cooldown, we queue it and send it after the cooldown (5s)
	if (!force && since < 5_000) {
		if (pendingRepost.has(channel.id)) return;
		pendingRepost.add(channel.id);

		setTimeout(() => {
			pendingRepost.delete(channel.id);

			void getSticky(sticky.guildId, channel.id)
				.then((fresh) => (fresh ? repostSticky(channel, fresh) : undefined))
				.catch(() => logger.error(`Failed to repost sticky in ${sticky.guildId}#${channel.id}`));
		}, 5_000 - since);

		return;
	}

	lastRepostAt.set(channel.id, Date.now());

	try {
		if (sticky.stickyMessageId) {
			await channel.messages.delete(sticky.stickyMessageId).catch(() => {});
		}

		const posted = await channel.send({
			content: `${sticky.stickyContent}\n-# This is a sticky message set by the moderators of this server.`,
			allowedMentions: { parse: [] },
		});
		await prisma.channel.update({ where: { id: channel.id }, data: { stickyMessageId: posted.id } });

		const cached = stickyCache.get(sticky.guildId);
		if (cached) {
			stickyCache.set(sticky.guildId, {
				...cached,
				stickies: cached.stickies.map((entry) =>
					entry.id === channel.id ? { ...entry, stickyMessageId: posted.id } : entry,
				),
			});
		}
	} catch {
		logger.error(`Failed to send sticky in ${sticky.guildId}#${channel.id}`);
	} finally {
		lastRepostAt.set(channel.id, Date.now());
	}
}
