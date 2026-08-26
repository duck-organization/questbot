// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Listener } from '@sapphire/framework';
import { ActivityType, type Client, Events } from 'discord.js';
import { purgeExpiredBans } from '#lib/bans.js';
import { giveawayScheduler } from '#lib/giveawayEvent.js';
import { enforceMute, getActiveMutes } from '#lib/mutes.js';
import { reminderScheduler } from '#lib/reminderEvent.js';
import { purgeExpiredWarns } from '#lib/warns.js';
import { heartbeat } from '#utils/heartbeat.js';
import { getShardInfo, isPrimaryShard } from '#utils/sharding.js';

export class ReadyListener extends Listener<typeof Events.ClientReady> {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			once: true,
			event: Events.ClientReady,
		});
	}

	public async run(client: Client<true>) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		const statuses = (process.env.STATUS ?? '')
			.split(',')
			.map((status) => status.trim())
			.filter(Boolean);
		const shardStatus = process.env.SHARD_STATUS === 'true';

		const applyStatus = (status: string) => {
			client.user.setActivity({
				name: shardStatus ? `${status} | Shard ${client.shard?.ids?.[0] ?? 0}` : status,
				type: ActivityType.Custom,
			});
		};

		// all shards read the exact minute and apply the same status
		const currentStatus = () => statuses[Math.floor(Date.now() / (60 * 1000)) % statuses.length] ?? '';

		applyStatus(currentStatus());

		if (statuses.length > 1) {
			setInterval(() => applyStatus(currentStatus()), 5 * 1000); // checks the minute every 5s
		}

		heartbeat(client);
		//* all schedulers currently run on a 30s interval
		reminderScheduler(client);
		giveawayScheduler(client);

		const enforceMutes = async () => {
			const mutes = await getActiveMutes(getShardInfo(client));
			for (const mute of mutes) {
				const guild = client.guilds.cache.get(mute.guildId);
				if (guild) await enforceMute(guild, mute.userId).catch((err) => console.error(err));
			}
		};

		const purge = () => {
			if (isPrimaryShard(client)) purgeExpiredWarns().catch((err) => console.error(err));
			purgeExpiredBans(client).catch((err) => console.error(err));
		};

		await enforceMutes().catch((err) => console.error(err));
		purge();

		setInterval(purge, 60 * 1000); // 1 min

		setInterval(
			() => {
				enforceMutes().catch((err) => console.error(err));
			},
			30 * 60 * 1000,
		); // 30 min
	}
}
