// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	type Guild,
	type Message,
	PermissionFlagsBits,
} from 'discord.js';
import { logEmbed } from '#lib/logging.js';
import type { ServerSettings } from '#lib/settings.js';

export const HONEYPOT_CHANNEL_NAME = 'dont-send-messages-here';
export const HONEYPOT_LEARN_ID = 'honeypot-learn-more';

export async function createHoneypot(guild: Guild) {
	const channel = await guild.channels.create({
		name: HONEYPOT_CHANNEL_NAME,
		type: ChannelType.GuildText,
		position: 0, // channels without a category sit above them, so this is the top of the list
	});

	const embed = new EmbedBuilder()
		.setTitle('🍯 Honey Pot')
		.setColor(0xffdc67)
		.setDescription('**DO NOT SEND MESSAGES HERE**')
		.setFooter({ text: 'You will be kicked if you send a message here.' });

	const learnMore = new ButtonBuilder()
		.setCustomId(HONEYPOT_LEARN_ID)
		.setLabel('Learn More')
		.setStyle(ButtonStyle.Secondary);

	await channel.send({
		embeds: [embed],
		components: [new ActionRowBuilder<ButtonBuilder>().addComponents(learnMore)],
	});

	return channel;
}

export async function deleteHoneypot(guild: Guild, channelId: string) {
	const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));

	await channel?.delete().catch((err) => console.error(err));
}

export async function enforceHoneypot(message: Message, settings: ServerSettings): Promise<boolean> {
	if (message.author.bot || !message.inGuild()) return false;
	if (message.channelId !== settings.honeypotChannelId) return false;

	// admins are exempt
	if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return false;

	const channel = message.channel;

	// message sent + overflow up to 50
	const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
	const theirs = recent?.filter((entry) => entry.author.id === message.author.id) ?? [message];

	await channel.bulkDelete(theirs, true).catch((err) => console.error(err));

	const REASON = `Honey Pot: ${message.author.tag} sent a message in #${channel.name}.`;
	const kicked = message.member?.kickable
		? await message.member
				.kick(REASON)
				.then(() => true)
				.catch((err) => {
					console.error(err);
					return false;
				})
		: false;

	const embed = new EmbedBuilder()
		.setTitle('Honey Pot')
		.setColor(0xffdc67)
		.addFields(
			{ name: 'Member', value: `${message.author.tag} (${message.author.id})`, inline: false },
			{ name: 'Channel', value: `<#${message.channelId}>`, inline: true },
			{ name: 'Action', value: kicked ? 'Kick + delete messages' : 'Delete messages', inline: true },
		)
		.setTimestamp();

	await logEmbed(message.guild, embed);

	return true;
}
