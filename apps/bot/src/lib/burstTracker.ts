// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

export type TrackedMessage = { channelId: string; messageId: string; sentAt: number };

export class BurstTracker {
	private readonly windowMs: number;
	private readonly tracking = new Map<string, TrackedMessage[]>();
	private lastSweepAt = 0;

	public constructor(windowMs: number) {
		this.windowMs = windowMs;
	}

	public record(key: string, entry: TrackedMessage): TrackedMessage[] {
		const now = Date.now();
		const cutoff = now - this.windowMs;

		if (this.tracking.size > 1000 && now - this.lastSweepAt > this.windowMs) {
			this.lastSweepAt = now;
			for (const [tracked, messages] of this.tracking) {
				if (messages.every((message) => message.sentAt <= cutoff)) this.tracking.delete(tracked);
			}
		}

		const recent = (this.tracking.get(key) ?? []).filter((message) => message.sentAt > cutoff);
		recent.push(entry);
		this.tracking.set(key, recent);

		return recent;
	}

	public clear(key: string): void {
		this.tracking.delete(key);
	}
}
