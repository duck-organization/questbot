// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, PermissionFlagsBits } from 'discord.js';
import { getAutoRoles } from '#lib/autorole.js';
import { logger } from '#lib/logger.js';
import { enforceMute } from '#lib/mutes.js';
import { sendWelcome } from '#lib/welcomeModule.js';

export class GuildMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			event: Events.GuildMemberAdd,
		});
	}

	public async run(member: GuildMember) {
		const botMember = member.guild.members.me;

		if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
			await enforceMute(member.guild, member.id).catch((err) => logger.error(err));
			await sendWelcome(member).catch((err) => logger.error(err));
			return;
		}

		const autoRoles = await getAutoRoles(member.guild.id).catch((err) => {
			logger.error(err);
			return [];
		});

		const rolesToAdd = autoRoles
			.filter((autoRole) => Boolean(autoRole.botRole) === member.user.bot)
			.map((autoRole) => member.guild.roles.cache.get(autoRole.roleId))
			.filter((role): role is NonNullable<typeof role> => Boolean(role?.editable))
			.map((role) => role.id);

		if (rolesToAdd.length > 0) {
			await member.roles.add(rolesToAdd).catch((err) => logger.error(err));
		}

		await enforceMute(member.guild, member.id).catch((err) => logger.error(err));
		await sendWelcome(member).catch((err) => logger.error(err));
	}
}
