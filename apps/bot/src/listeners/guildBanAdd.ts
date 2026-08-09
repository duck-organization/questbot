// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { AuditLogEvent, EmbedBuilder, Events, type GuildBan } from 'discord.js';
import { getRecentAuditLogEntry, logEmbed } from '#lib/logging.js';

export class GuildBanAddListener extends Listener<typeof Events.GuildBanAdd> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			event: Events.GuildBanAdd,
		});
	}

	public async run(ban: GuildBan) {
		const auditEntry = await getRecentAuditLogEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

		const embed = new EmbedBuilder()
			.setTitle('Member Banned')
			.setColor(0xff6962)
			.addFields(
				{ name: 'Member', value: `${ban.user.tag} (${ban.user.id})`, inline: false },
				{ name: 'Username', value: ban.user.toString(), inline: true },
			)
			.setTimestamp();

		if (auditEntry?.executor) {
			embed.addFields({ name: 'Moderator', value: `<@${auditEntry.executor.id}>`, inline: true });
		}

		if (auditEntry?.reason) {
			embed.addFields({ name: 'Reason', value: auditEntry.reason, inline: false });
		}

		await logEmbed(ban.guild, embed);
	}
}
