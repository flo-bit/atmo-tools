import { error } from '@sveltejs/kit';
import { command, getRequestEvent } from '$app/server';
import * as v from 'valibot';

export const listLikeRecords = command(
	v.object({
		limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
		cursor: v.optional(v.string())
	}),
	async (input) => {
		const { locals } = getRequestEvent();
		if (!locals.client || !locals.did) error(401, 'Not authenticated');

		const response = await locals.client.get('com.atproto.repo.listRecords', {
			params: {
				repo: locals.did,
				collection: 'app.bsky.feed.like',
				limit: input.limit ?? 100,
				cursor: input.cursor,
				reverse: false
			}
		});

		if (!response.ok) error(500, 'Failed to fetch like records');

		return response.data;
	}
);

export const listPostRecords = command(
	v.object({
		limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
		cursor: v.optional(v.string())
	}),
	async (input) => {
		const { locals } = getRequestEvent();
		if (!locals.client || !locals.did) error(401, 'Not authenticated');

		const response = await locals.client.get('com.atproto.repo.listRecords', {
			params: {
				repo: locals.did,
				collection: 'app.bsky.feed.post',
				limit: input.limit ?? 100,
				cursor: input.cursor,
				reverse: false
			}
		});

		if (!response.ok) error(500, 'Failed to fetch post records');

		return response.data;
	}
);

export const getBookmarks = command(
	v.object({
		limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
		cursor: v.optional(v.string())
	}),
	async (input) => {
		const { locals } = getRequestEvent();
		if (!locals.client || !locals.did) error(401, 'Not authenticated');

		let response;
		try {
			response = await locals.client.get('app.bsky.bookmark.getBookmarks', {
				params: {
					limit: input.limit ?? 100,
					cursor: input.cursor
				}
			});
		} catch (err) {
			console.error('Bookmarks server error:', err);
			error(500, `Bookmarks request failed: ${err}`);
		}

		if (!response.ok) {
			console.error('Bookmarks response not ok:', response.status, response.data);
			error(500, `Bookmarks failed: ${response.status} ${JSON.stringify(response.data)}`);
		}

		return response.data;
	}
);
