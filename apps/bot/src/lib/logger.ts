// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

// Hey! We handling all of the logging here.
// That way we can easily swap out whatever system we use such as sentry, betterstack, grafana, etc. in the future.
export const logger = {
	log: (...args: unknown[]) => console.log(...args),
	warn: (...args: unknown[]) => console.warn(...args),
	error: (...args: unknown[]) => console.error(...args),
	debug: (...args: unknown[]) => console.debug(...args),
};
