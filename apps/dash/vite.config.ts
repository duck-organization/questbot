// QuestBot: A free and open-source Discord Bot.
// Copyright(C) 2026 Vantern
// SPDX-License-Identifier: AGPL-3.0-or-later

import path from 'node:path';
import mdx from '@mdx-js/rollup';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vite';

export default defineConfig({
	resolve: {
		alias: {
			'~': path.resolve(import.meta.dirname, './app'),
		},
	},
	plugins: [
		{
			enforce: 'pre',
			...mdx({
				remarkPlugins: [remarkGfm],
				rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
			}),
		},
		reactRouter(),
		tailwindcss(),
	],
	ssr: {
		external: ['@questbot/database'],
	},
});
