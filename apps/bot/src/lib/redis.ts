// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Redis } from 'ioredis';

if (!process.env.REDIS_URL) throw new Error('REDIS_URL is not set');

export const connection = new Redis(process.env.REDIS_URL, {
	maxRetriesPerRequest: null,
});
