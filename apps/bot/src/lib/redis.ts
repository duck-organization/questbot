// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Redis } from 'ioredis';

// maxRetriesPerRequest must be null for BullMQ's blocking connections
export const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
	maxRetriesPerRequest: null,
});
