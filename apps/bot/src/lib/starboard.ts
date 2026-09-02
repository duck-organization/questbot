// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Prisma, prisma } from '@questbot/database';
import {
	DiscordAPIError,
	EmbedBuilder,
	type Guild,
	type GuildTextBasedChannel,
	type Message,
	type MessageReaction,
	OverwriteType,
	type PartialUser,
	PermissionFlagsBits,
	RESTJSONErrorCodes,
	type User,
} from 'discord.js';
import { truncate } from '#lib/logging.js';
import { getSettings } from '#lib/settings.js';
import { Colors } from '#utils/embeds.js';
import { getChannel } from '#utils/getChannel.js';

function normalize(emoji: string | null | undefined): string {
	return (emoji ?? '').replace(/️/g, '');
}

function reactionEmoji(reaction: MessageReaction): string {
	return reaction.emoji.id ? reaction.emoji.toString() : (reaction.emoji.name ?? '');
}

function findReaction(message: Message | null, emoji: string): MessageReaction | null {
	return message?.reactions.cache.find((found) => normalize(reactionEmoji(found)) === normalize(emoji)) ?? null;
}

async function reactorIds(reaction: MessageReaction): Promise<Set<string>> {
	const ids = new Set<string>();
	let after: string | undefined;

	while (true) {
		const users = await reaction.users.fetch({ limit: 100, after }).catch(() => null);
		if (!users?.size) break;

		for (const id of users.keys()) ids.add(id);
		if (users.size < 100) break;

		after = users.lastKey();
	}

	return ids;
}

async function countStars(emoji: string, message: Message, posted: Message | null): Promise<number> {
	const source = findReaction(message, emoji);
	const mirror = findReaction(posted, emoji);

	const stars = source?.count ?? 0;
	const mirrored = (mirror?.count ?? 0) - (mirror?.me ? 1 : 0); //* our reaction is a "shortcut" not a star

	// only fetch on overlap between both
	if (!source || !mirror || mirrored < 1) return stars + Math.max(mirrored, 0);

	const starred = await reactorIds(source);
	const both = [...(await reactorIds(mirror))].filter((id) => starred.has(id)).length;

	return stars + mirrored - both;
}

function appearsAcrossChannels(source: GuildTextBasedChannel, starboard: GuildTextBasedChannel): boolean {
	if (source.permissionsFor(source.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return false;

	for (const role of source.guild.roles.cache.values()) {
		if (!starboard.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) continue;
		if (!source.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) return true;
	}

	const overwrites = starboard.isThread() ? starboard.parent?.permissionOverwrites : starboard.permissionOverwrites;

	for (const overwrite of overwrites?.cache.values() ?? []) {
		if (overwrite.type !== OverwriteType.Member) continue;
		if (!overwrite.allow.has(PermissionFlagsBits.ViewChannel)) continue;

		const member = source.guild.members.cache.get(overwrite.id);
		if (member && !source.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return true;
	}

	return false;
}

function buildStarboardMessage(message: Message<true>, emoji: string, count: number, posted: Message | null) {
	const image = [...message.attachments.values()].find((attachment) => attachment.contentType?.startsWith('image/'));
	const imageUrl = image?.url ?? posted?.embeds[0]?.image?.url;

	const embed = new EmbedBuilder()
		.setColor(Colors.info)
		.setAuthor({ name: message.author.displayName, iconURL: message.author.displayAvatarURL() })
		.setDescription(truncate(message.content, 4096) || null)
		.addFields({ name: 'Source', value: `${message.url}` })
		.setFooter({ text: `ID: ${message.id}` })
		.setTimestamp(message.createdAt);

	if (imageUrl) embed.setImage(imageUrl);

	return {
		content: `${emoji} | **${count}**`,
		embeds: [embed],
		allowedMentions: { parse: [] },
	};
}

export async function getStarboardEntry(messageId: string) {
	return prisma.starboard.findUnique({ where: { messageId } });
}

export async function removeStarboardEntry(messageId: string) {
	await prisma.starboard.deleteMany({ where: { messageId } });
}

async function purgeStarboardEntries(guild: Guild, where: Prisma.StarboardWhereInput): Promise<void> {
	const entries = await prisma.starboard.findMany({ where: { ...where, guildId: guild.id } });
	if (!entries.length) return;

	const settings = await getSettings(guild.id);
	const starboard = settings.starboardChannelId
		? await getChannel(guild.client.channels, settings.starboardChannelId)
		: null;

	if (starboard?.isTextBased()) {
		await Promise.allSettled(entries.map((entry) => starboard.messages.delete(entry.starboardMessageId)));
	}

	await prisma.starboard.deleteMany({ where: { messageId: { in: entries.map((entry) => entry.messageId) } } });
}

export async function clearStarboardEntries(guildId: string): Promise<void> {
	await prisma.starboard.deleteMany({ where: { guildId } });
}

export async function removeStarboardPostsByMessages(guild: Guild, messageIds: string[]): Promise<void> {
	if (!messageIds.length) return;

	await purgeStarboardEntries(guild, { messageId: { in: messageIds } });
}

export async function removeStarboardPostsByChannel(guild: Guild, channelId: string): Promise<void> {
	await purgeStarboardEntries(guild, { channelId });
}

export async function syncStarboard(reaction: MessageReaction, user: User | PartialUser): Promise<void> {
	if (user.id === reaction.client.user.id) return; // our initial reaction does NOT count

	const full = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
	if (!full) return;

	const reacted = full.message.partial ? await full.message.fetch().catch(() => null) : full.message;
	if (!reacted?.inGuild()) return;

	const settings = await getSettings(reacted.guildId);
	if (!settings.starboardEnable || !settings.starboardChannelId) return;
	if (normalize(reactionEmoji(full)) !== normalize(settings.starboardEmoji)) return;

	const channel = await getChannel(reacted.client.channels, settings.starboardChannelId);
	if (!channel?.isTextBased() || channel.isDMBased() || !channel.isSendable()) return;

	const isPost = reacted.author.id === reacted.client.user.id && reacted.channelId === settings.starboardChannelId;
	const entry = isPost
		? await prisma.starboard.findUnique({ where: { starboardMessageId: reacted.id } })
		: await getStarboardEntry(reacted.id);

	if (isPost && !entry) return; //* don't post our own messages from the starboard channel but allow other users to be posted from the starboard channel

	let message = reacted;
	let posted: Message | null = isPost ? reacted : null;

	if (isPost && entry) {
		//* reaction on our posts counts towards the message it mirrors
		const origin = await getChannel(reacted.client.channels, entry.channelId);
		if (!origin?.isTextBased()) return;

		try {
			const original = await origin.messages.fetch(entry.messageId);
			if (!original.inGuild()) return;

			message = original;
		} catch (err: unknown) {
			if (!(err instanceof DiscordAPIError) || err.code !== RESTJSONErrorCodes.UnknownMessage) return;

			//* the mirrored message is gone, so we don't have to track it anymore
			await reacted.delete().catch(() => {});
			await removeStarboardEntry(entry.messageId);

			return;
		}
	} else if (entry) {
		try {
			posted = await channel.messages.fetch(entry.starboardMessageId);
		} catch (err: unknown) {
			if (!(err instanceof DiscordAPIError) || err.code !== RESTJSONErrorCodes.UnknownMessage) return;

			// post removed = forever removed (previously would come back)
			await removeStarboardEntry(entry.messageId);

			return;
		}
	}

	if (appearsAcrossChannels(message.channel, channel)) {
		await posted?.delete().catch(() => {});
		if (entry) await removeStarboardEntry(entry.messageId);

		return;
	}

	const emoji = settings.starboardEmoji;
	const count = await countStars(emoji, message, posted);

	if (count < settings.starboardRequirement) {
		if (!entry) return;

		await posted?.delete().catch(() => {});
		await removeStarboardEntry(message.id);

		return;
	}

	const payload = buildStarboardMessage(message, emoji, count, posted);

	if (posted) {
		if (posted.content !== payload.content) await posted.edit(payload).catch(() => {});
		return;
	}

	const sent = await channel.send(payload).catch(() => null);
	if (!sent) return;

	const created = await prisma.starboard
		.create({
			data: {
				messageId: message.id,
				guildId: message.guildId,
				channelId: message.channelId,
				starboardMessageId: sent.id,
			},
		})
		.catch(() => null);

	if (!created) {
		await sent.delete().catch(() => {});
		return;
	}

	// react with the emoji on the post
	await sent.react(emoji).catch((err) => console.error(err));
}
