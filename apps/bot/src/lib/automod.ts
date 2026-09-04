// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type AutoModRuleType, Prisma, prisma } from '@questbot/database';
import { EmbedBuilder, type Message, PermissionFlagsBits } from 'discord.js';
import { applyBan } from './bans.js';
import { BurstTracker } from './burstTracker.js';
import { LIMITS_ENABLED, LimitError } from './limits.js';
import { logEmbed } from './logging.js';
import type { ServerSettings } from './settings.js';

const MAX_RULES = 20;

export const AUTOMOD_ACTIONS = {
	delete: 'Delete messages',
	kickDelete: 'Kick + delete messages',
	banDelete: 'Ban + delete messages',
} as const;

export type AutoModAction = keyof typeof AUTOMOD_ACTIONS;

export class DuplicateAutoModRuleError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'DuplicateAutoModRuleError';
	}
}

export class InvalidRegexError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'InvalidRegexError';
	}
}

// TODO: improve link regex
// blocks (most) links but should be improved
const LINK_REGEX = /https?:\/\/\S+|www\.\S+|discord\.gg\/\S+/i;
// erm this would kill us
const DOS_REGEX = /\([^()]*[+*][^()]*\)[+*?]|\([^()]*\|[^()]*\)[+*]/;
// prevents against regex that could lag the loop
const UNBOUNDED_REGEX = /\([^()]*[+*][^()]*\)/g;

export function checkRegex(pattern: string): void {
	if (pattern.length > 100) {
		throw new InvalidRegexError(`Regex patterns cannot be longer than 100 characters.`);
	}

	if (DOS_REGEX.test(pattern)) {
		throw new InvalidRegexError('That pattern could cause performance issues and is not allowed.');
	}

	const quantifiedGroupCount = pattern.match(UNBOUNDED_REGEX)?.length ?? 0;
	if (quantifiedGroupCount > 1) {
		throw new InvalidRegexError('That pattern could cause performance issues and is not allowed.');
	}

	try {
		new RegExp(pattern, 'i');
	} catch {
		throw new InvalidRegexError('That is not a valid regex pattern.');
	}
}

// rule types
export type WordRuleConfig = { method: 'WORD' | 'REGEX'; pattern: string; action: AutoModAction };
export type SpamRuleConfig = { range: 'ALL_CHANNELS' | 'PER_CHANNEL'; threshold: number; action: AutoModAction };
export type LinksRuleConfig = { action: AutoModAction };

// for the auto mod (rule) row
type RuleBase = { id: string; guildId: string; createdAt: Date };
export type AutoModRuleRow =
	| (RuleBase & { type: 'WORD'; config: WordRuleConfig; compiledPattern?: RegExp })
	| (RuleBase & { type: 'SPAM'; config: SpamRuleConfig })
	| (RuleBase & { type: 'LINKS'; config: LinksRuleConfig });

function isValidRuleConfig(row: { type: AutoModRuleType; config: unknown }): boolean {
	if (row.type === 'WORD') {
		const config = row.config as Partial<WordRuleConfig> | null;
		return (config?.method === 'WORD' || config?.method === 'REGEX') && typeof config.pattern === 'string';
	}

	if (row.type === 'SPAM') {
		const config = row.config as Partial<SpamRuleConfig> | null;
		return (
			(config?.range === 'ALL_CHANNELS' || config?.range === 'PER_CHANNEL') && typeof config.threshold === 'number'
		);
	}

	return true;
}

// validates against the function above and returns null if invalid
function validateRule(row: {
	id: string;
	guildId: string;
	type: AutoModRuleType;
	config: unknown;
	createdAt: Date;
}): AutoModRuleRow | null {
	if (!isValidRuleConfig(row)) {
		console.error(`Skipped automod rule ${row.id} in guild ${row.guildId}, config doesn't match type ${row.type}.`);
		return null;
	}

	const rule = row as AutoModRuleRow;
	if (rule.type === 'WORD' && rule.config.method === 'REGEX') {
		try {
			rule.compiledPattern = new RegExp(rule.config.pattern, 'i');
		} catch {}
	}

	return rule;
}

const rulesCache = new Map<string, { rules: AutoModRuleRow[]; expiresAt: number }>();

async function getRules(guildId: string): Promise<AutoModRuleRow[]> {
	const cached = rulesCache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) return cached.rules;

	const rows = await prisma.autoModRule.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
	const rules = rows.map(validateRule).filter((rule) => rule !== null);

	rulesCache.set(guildId, { rules, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 min ttl

	return rules;
}

export function forgetAutoModRules(guildId: string): void {
	rulesCache.delete(guildId);
}

async function upsertServer(guildId: string, guildName: string): Promise<void> {
	await prisma.server.upsert({
		where: { id: guildId },
		create: { id: guildId, name: guildName },
		update: { name: guildName },
	});
}

async function createRule<Config extends Prisma.InputJsonValue>(
	guildId: string,
	guildName: string,
	type: AutoModRuleType,
	config: Config,
	isDuplicate: (existing: { config: unknown }[]) => boolean,
	duplicateMessage: string,
): Promise<AutoModRuleRow> {
	await upsertServer(guildId, guildName);

	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const created = await prisma.$transaction(
				async (tx) => {
					if (LIMITS_ENABLED) {
						const count = await tx.autoModRule.count({ where: { guildId } });
						if (count >= MAX_RULES) {
							throw new LimitError(`A guild can only have up to ${MAX_RULES} automod rules.`);
						}
					}

					const existing = await tx.autoModRule.findMany({ where: { guildId, type }, select: { config: true } });
					if (isDuplicate(existing)) {
						throw new DuplicateAutoModRuleError(duplicateMessage);
					}

					return tx.autoModRule.create({ data: { guildId, type, config } });
				},
				{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
			);

			forgetAutoModRules(guildId);

			return validateRule(created) as AutoModRuleRow;
		} catch (err) {
			if ((err as { code?: string }).code === 'P2034' && attempt < 3) continue;
			throw err;
		}
	}

	throw new Error('unreachable');
}

export async function createWordRule(
	guildId: string,
	guildName: string,
	method: 'WORD' | 'REGEX',
	pattern: string,
	action: AutoModAction,
) {
	if (!pattern?.trim()) {
		throw new Error('The word or pattern cannot be empty.');
	}

	if (method === 'REGEX') checkRegex(pattern);

	const config: WordRuleConfig = { method, pattern, action };

	return createRule(
		guildId,
		guildName,
		'WORD',
		config,
		(existing) =>
			existing.some((row) => {
				const existingConfig = row.config as WordRuleConfig;
				return existingConfig.method === method && existingConfig.pattern === pattern;
			}),
		'That word or pattern is already blocked in this server.',
	);
}

export async function createSpamRule(
	guildId: string,
	guildName: string,
	range: 'ALL_CHANNELS' | 'PER_CHANNEL',
	threshold: number,
	action: AutoModAction,
) {
	const config: SpamRuleConfig = { range, threshold, action };

	return createRule(
		guildId,
		guildName,
		'SPAM',
		config,
		(existing) => existing.length > 1,
		'2 spam rules already exists in this server. Remove one before adding another.',
	);
}

export async function createLinksRule(guildId: string, guildName: string, action: AutoModAction) {
	const config: LinksRuleConfig = { action };

	return createRule(
		guildId,
		guildName,
		'LINKS',
		config,
		(existing) => existing.length > 0,
		'A links rule already exists in this server. Remove it before adding another.',
	);
}

export async function getAutoModRules(guildId: string): Promise<AutoModRuleRow[]> {
	return getRules(guildId);
}

export async function getAutoModRule(ruleId: string): Promise<AutoModRuleRow | null> {
	const row = await prisma.autoModRule.findUnique({ where: { id: ruleId } });
	return row ? validateRule(row) : null;
}

export async function removeAutoModRule(ruleId: string) {
	const removed = await prisma.autoModRule.delete({ where: { id: ruleId } });
	forgetAutoModRules(removed.guildId);

	return removed;
}

export function autoModDescription(rule: AutoModRuleRow): string {
	const action = AUTOMOD_ACTIONS[rule.config.action];

	if (rule.type === 'WORD') {
		return `Block messages containing ${rule.config.method === 'REGEX' ? 'regex: ' : 'the word: '} ${rule.config.pattern} (${action})`;
	}

	if (rule.type === 'SPAM') {
		return `Prevent spam ${rule.config.range === 'PER_CHANNEL' ? 'per channel' : 'across all channels'}, message threshold ${rule.config.threshold} per 5s (${action})`;
	}

	return `Block messages containing links (${action})`;
}

function checkWordRule(rule: Extract<AutoModRuleRow, { type: 'WORD' }>, text: string, lowerText: string): boolean {
	if (rule.config.method === 'WORD') return lowerText.includes(rule.config.pattern.toLowerCase());

	return rule.compiledPattern?.test(text) ?? false;
}

// used outside of messageCreate for stuff like nicknames, reminders, confessions, sticky messages, blabla
export async function containsBlockedWord(guildId: string, text: string): Promise<boolean> {
	const rules = await getRules(guildId);
	const lowerText = text.toLowerCase();

	return rules.filter((rule) => rule.type === 'WORD').some((rule) => checkWordRule(rule, text, lowerText));
}

async function blockMessage(message: Message, reason: string): Promise<void> {
	const channel = message.channel;

	await Promise.all([
		message.delete().catch((err) => console.error(err)),
		channel.isTextBased() && channel.isSendable()
			? channel.send(`<@${message.author.id}>, ${reason}`).catch((err) => console.error(err))
			: undefined,
	]);
}

async function applyAutoModAction(message: Message, action: AutoModAction, reason: string): Promise<void> {
	if (!message.inGuild()) return;

	if (action === 'kickDelete' && message.member?.kickable) {
		await message.member.kick(reason).catch((err) => console.error(err));
	} else if (action === 'banDelete') {
		await applyBan(message.guild, message.author.id, reason);
	}
}

async function logAutoMod(message: Message, rule: AutoModRuleRow, title: string): Promise<void> {
	if (!message.inGuild()) return;

	// log rule triggers (added v1.3.1)
	const embed = new EmbedBuilder()
		.setTitle(`Automod: ${title}`)
		.setColor(0xff6962)
		.addFields(
			{ name: 'Member', value: `${message.author.tag} (${message.author.id})`, inline: false },
			{ name: 'Channel', value: `<#${message.channelId}>`, inline: true },
			{ name: 'Rule', value: autoModDescription(rule), inline: false },
		)
		.setTimestamp();

	await logEmbed(message.guild, embed);
}

const spamTracking = new BurstTracker(5_000);

async function checkSpamRule(message: Message, rule: Extract<AutoModRuleRow, { type: 'SPAM' }>): Promise<boolean> {
	if (!message.inGuild()) return false;

	const config = rule.config;
	const key = `${message.guildId}:${message.author.id}`;
	const recent = spamTracking.record(key, { channelId: message.channelId, messageId: message.id, sentAt: Date.now() });

	const relevant =
		config.range === 'PER_CHANNEL' ? recent.filter((entry) => entry.channelId === message.channelId) : recent;

	if (relevant.length < config.threshold) return false;

	spamTracking.clear(key);

	const guild = message.guild;

	await Promise.all(
		relevant.map((entry) => {
			const channel = guild.channels.cache.get(entry.channelId);
			return channel?.isTextBased() ? channel.messages.delete(entry.messageId).catch(() => {}) : undefined;
		}),
	);

	const channel = message.channel;

	await Promise.all([
		channel.isTextBased() && channel.isSendable()
			? channel
					.send(`<@${message.author.id}>, slow down! Your recent messages have been deleted for spamming.`)
					.catch(() => {})
			: undefined,
		logAutoMod(message, rule, 'Spam'),
		applyAutoModAction(message, config.action, 'Automod: spam rule triggered.'),
	]);

	return true;
}

export async function enforceAutoMod(message: Message, settings: ServerSettings): Promise<boolean> {
	if (message.author.bot || !message.inGuild()) return false;

	const permissions = message.member?.permissions;
	const isExempt =
		permissions?.has(PermissionFlagsBits.Administrator) ||
		permissions?.has(PermissionFlagsBits.ManageGuild) ||
		(settings.automodExemptRoleId ? (message.member?.roles.cache.has(settings.automodExemptRoleId) ?? false) : false);

	if (isExempt) return false;

	const rules = await getRules(message.guildId);
	if (rules.length === 0) return false;

	let spamRule: Extract<AutoModRuleRow, { type: 'SPAM' }> | undefined;
	const lowerContent = message.content.toLowerCase();

	for (const rule of rules) {
		if (rule.type === 'WORD' && checkWordRule(rule, message.content, lowerContent)) {
			await Promise.all([
				blockMessage(message, 'that word or phrase is not allowed here!'),
				logAutoMod(message, rule, 'Blocked Word'),
				applyAutoModAction(message, rule.config.action, 'Automod: blocked word rule triggered.'),
			]);
			return true;
		}

		if (rule.type === 'LINKS' && LINK_REGEX.test(message.content)) {
			await Promise.all([
				blockMessage(message, 'links are not allowed here!'),
				logAutoMod(message, rule, 'Blocked Link'),
				applyAutoModAction(message, rule.config.action, 'Automod: blocked link rule triggered.'),
			]);
			return true;
		}

		if (rule.type === 'SPAM') spamRule = rule;
	}

	if (spamRule) return checkSpamRule(message, spamRule);

	return false;
}
