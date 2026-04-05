import { user } from '$lib/atproto';
import { toast } from '@foxui/core';
import { Document, Charset, IndexedDB } from 'flexsearch';
import { Client, simpleFetchHandler } from '@atcute/client';
import { openDb, getDb, type StoredPost } from '$lib/db';

export type SourceType = 'likes' | 'bookmarks' | 'posts' | 'reposts' | 'replies';

export type SearchFilters = {
	handles: string[];
	minLikes: number;
	minReposts: number;
	minReplies: number;
	dateAfter: string;
	dateBefore: string;
	hasImage: boolean;
	hasLink: boolean;
	hasVideo: boolean;
	showReplies: boolean;
	onlyReplies: boolean;
};

export const DEFAULT_FILTERS: SearchFilters = {
	handles: [],
	minLikes: 0,
	minReposts: 0,
	minReplies: 0,
	dateAfter: '',
	dateBefore: '',
	hasImage: false,
	hasLink: false,
	hasVideo: false,
	showReplies: true,
	onlyReplies: false
};

export const SOURCE_LABELS: Record<SourceType, string> = {
	likes: 'Likes',
	bookmarks: 'Bookmarks',
	posts: 'Posts',
	reposts: 'Reposts',
	replies: 'Replies'
};

export const PLACEHOLDERS: Record<SourceType, string> = {
	likes: 'Search liked posts',
	bookmarks: 'Search bookmarks',
	posts: 'Search my posts',
	reposts: 'Search reposted posts',
	replies: 'Search replies to my posts'
};

export const ALL_SOURCES: SourceType[] = ['likes', 'bookmarks', 'posts', 'reposts', 'replies'];

type SourceState = {
	index: Document | null;
	count: number;
	phase: 'idle' | 'loading' | 'done';
};

function createSourceState(): SourceState {
	return {
		index: null,
		count: 0,
		phase: 'idle'
	};
}

function createIndex() {
	return new Document({
		document: {
			id: 'uri',
			store: false,
			index: [
				{
					field: 'author:handle',
					tokenize: 'forward',
					encoder: Charset.LatinBalance
				},
				{
					field: 'author:displayName',
					tokenize: 'forward',
					encoder: Charset.LatinBalance
				},
				{
					field: 'record:text',
					tokenize: 'forward',
					encoder: Charset.LatinBalance
				},
				{
					field: '_embedText',
					tokenize: 'forward',
					encoder: Charset.LatinBalance
				}
			]
		}
	});
}

function getEmbedText(post: any): string {
	const parts: string[] = [];
	const embed = post.embed;
	if (!embed) return '';

	// Link embed: title + description
	if (embed.$type === 'app.bsky.embed.external#view') {
		if (embed.external?.title) parts.push(embed.external.title);
		if (embed.external?.description) parts.push(embed.external.description);
	}

	// Quote embed: quoted post text
	if (embed.$type === 'app.bsky.embed.record#view') {
		if (embed.record?.value?.text) parts.push(embed.record.value.text);
	}

	// Record + media combo
	if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
		if (embed.record?.record?.value?.text) parts.push(embed.record.record.value.text);
		const media = embed.media;
		if (media?.$type === 'app.bsky.embed.external#view') {
			if (media.external?.title) parts.push(media.external.title);
			if (media.external?.description) parts.push(media.external.description);
		}
	}

	return parts.join(' ');
}

function indexPost(index: Document, post: any) {
	const embedText = getEmbedText(post);
	if (embedText) {
		index.add({ ...post, _embedText: embedText } as any);
	} else {
		index.add(post as any);
	}
}

const publicClient = new Client({
	handler: simpleFetchHandler({ service: 'https://public.api.bsky.app' })
});

export const searchState = $state({
	sources: {
		likes: createSourceState(),
		bookmarks: createSourceState(),
		posts: createSourceState(),
		reposts: createSourceState(),
		replies: createSourceState()
	} as Record<SourceType, SourceState>,
	activeSource: 'likes' as SourceType
});

let generation = 0;

export async function initSources() {
	if (!user.did) return;

	const db = openDb(user.did);

	// Clean up legacy localStorage data
	for (const source of ALL_SOURCES) {
		localStorage.removeItem(`${source}-ids`);
		localStorage.removeItem(`${source}-cursor`);
	}

	await Promise.all(
		ALL_SOURCES.map(async (source) => {
			const flexDb = new IndexedDB(`${user.did}-${source}-idx`);
			searchState.sources[source].index = createIndex();
			await searchState.sources[source].index!.mount(flexDb);

			// Get count from Dexie
			searchState.sources[source].count = await db.posts
				.where('sources')
				.equals(source)
				.count();
		})
	);

	// Start loading (active source first via loadNext)
	startLoading(searchState.activeSource);
}

export function switchSource(source: SourceType) {
	if (source === searchState.activeSource) return;
	searchState.activeSource = source;
	generation++;
	if (searchState.sources[source].phase !== 'done') {
		startLoading(source);
	} else {
		loadNext(generation);
	}
}

export function startLoading(source: SourceType) {
	generation++;
	const myGen = generation;

	if (source === 'bookmarks') {
		loadBookmarks(source, myGen);
	} else if (source === 'replies') {
		loadReplies(myGen);
	} else {
		loadRecords(source, myGen);
	}
}

function loadNext(currentGen: number) {
	if (currentGen !== generation) return;

	const sorted = [
		searchState.activeSource,
		...ALL_SOURCES.filter((s) => s !== searchState.activeSource)
	];
	for (const source of sorted) {
		if (searchState.sources[source].phase !== 'done') {
			startLoading(source);
			return;
		}
	}
}

async function fetchAndHydratePage(
	source: SourceType,
	s: SourceState,
	fetchFn: Function,
	cursor: string | undefined,
	myGen: number,
	stopOnExisting = true
): Promise<{ cursor: string | undefined; done: boolean }> {
	if (myGen !== generation) return { cursor, done: true };

	let data: any;
	try {
		data = await fetchFn({ limit: 100, cursor });
	} catch (err) {
		console.error(`Failed to fetch ${source}:`, err);
		toast.error(`Failed to fetch ${source}`);
		return { cursor, done: true };
	}

	const uris = data.records.map((r: any) =>
		source === 'posts' ? r.uri : r.value.subject.uri
	);
	const db = getDb();
	const existingDocs = await db.posts.bulkGet(uris);
	const toUpdate: any[] = [];
	const toHydrate: string[] = [];
	const now = Date.now();

	for (let j = 0; j < uris.length; j++) {
		const subjectUri = uris[j];
		const existing = existingDocs[j];

		if (existing) {
			if (existing.sources.includes(source)) {
				if (stopOnExisting) {
					// Already indexed for this source — flush updates and stop.
					const lastRecord = data.records[j];
					const stopCursor = lastRecord?.uri?.split('/').pop() ?? data.cursor;
					if (toUpdate.length > 0) await db.posts.bulkPut(toUpdate);
					return { cursor: stopCursor, done: true };
				}
				// Resuming an interrupted fetch — skip already-processed posts
				continue;
			}
			// Post exists from another source — add source tag
			toUpdate.push({ ...existing, sources: [...existing.sources, source], fetchedAt: now });
			indexPost(s.index!, existing);
			s.count++;
			continue;
		}

		toHydrate.push(subjectUri);
	}

	if (toUpdate.length > 0) await db.posts.bulkPut(toUpdate);

	// Hydrate new URIs inline via getPosts
	if (toHydrate.length > 0) {
		const BATCH = 25;
		const batches: string[][] = [];
		for (let i = 0; i < toHydrate.length; i += BATCH) {
			batches.push(toHydrate.slice(i, i + BATCH));
		}

		const results = await Promise.all(
			batches.map((batch) =>
				publicClient
					.get('app.bsky.feed.getPosts', { params: { uris: batch as any } })
					.catch((e) => {
						console.error(`Failed to hydrate ${source} batch:`, e);
						return null;
					})
			)
		);

		const allPosts: any[] = [];
		for (const result of results) {
			if (result?.ok) allPosts.push(...result.data.posts);
		}

		if (allPosts.length > 0) {
			const existingPosts = await db.posts.bulkGet(allPosts.map((p) => p.uri));
			const existingMap = new Map<string, StoredPost>();
			for (const doc of existingPosts) {
				if (doc) existingMap.set(doc.uri, doc);
			}

			const toPut: any[] = [];
			for (const post of allPosts) {
				const ex = existingMap.get(post.uri);
				if (ex) {
					toPut.push({ ...post, sources: [...ex.sources, source], savedAt: ex.savedAt, fetchedAt: now });
				} else {
					toPut.push({ ...post, sources: [source], savedAt: now, fetchedAt: now });
				}
				indexPost(s.index!, post);
				s.count++;
			}

			await db.posts.bulkPut(toPut);
		}
	}

	await s.index!.commit();

	const nextCursor = data.records.length > 0 ? data.cursor : undefined;
	if (nextCursor && nextCursor === cursor) {
		return { cursor: nextCursor, done: true };
	}
	return { cursor: nextCursor, done: !nextCursor };
}

async function loadRecords(source: SourceType, myGen: number) {
	if (!user.did || !searchState.sources[source].index) return;

	const { listLikeRecords, listPostRecords, listRepostRecords } = await import(
		'$lib/atproto/server/search.remote'
	);
	const fetchFn =
		source === 'likes'
			? listLikeRecords
			: source === 'reposts'
				? listRepostRecords
				: listPostRecords;

	const s = searchState.sources[source];
	s.phase = 'loading';

	const db = getDb();
	const meta = await db.meta.get(source);

	// Step 1: Fetch new posts from the top until we hit one we already have
	// If fetchCursor is set, we were interrupted last time — resume from there
	const isResuming = !!meta?.fetchCursor;
	let result = { cursor: meta?.fetchCursor as string | undefined, done: false };
	do {
		// When resuming, don't stop on existing posts — the interrupted page
		// may have partially-hydrated posts in Dexie that would trigger a false stop
		result = await fetchAndHydratePage(source, s, fetchFn, result.cursor, myGen, !isResuming);
		if (myGen !== generation) return;
		// Save fetch progress so we can resume on reload
		if (!result.done && result.cursor) {
			await db.meta.put({ ...meta, source, fetchCursor: result.cursor });
		}
	} while (!result.done);

	// Pass 1 complete — clear fetchCursor
	await db.meta.put({ ...meta, source, fetchCursor: undefined });

	// Step 2: Continue from where we left off last time (tail)
	if (meta?.tailCursor) {
		result = { cursor: meta.tailCursor, done: false };
		do {
			result = await fetchAndHydratePage(source, s, fetchFn, result.cursor, myGen);
			if (myGen !== generation) return;
			// Save tail progress incrementally
			if (result.cursor) {
				await db.meta.put({ source, tailCursor: result.cursor });
			}
		} while (!result.done);
	}

	// Save final tail position
	if (result.cursor) {
		await db.meta.put({ source, tailCursor: result.cursor });
	} else {
		await db.meta.put({ source, tailCursor: undefined });
	}

	s.phase = 'done';
	loadNext(myGen);
}

async function fetchBookmarkPage(
	source: SourceType,
	s: SourceState,
	getBookmarks: Function,
	cursor: string | undefined,
	myGen: number,
	stopOnExisting = true
): Promise<{ cursor: string | undefined; done: boolean }> {
	if (myGen !== generation) return { cursor, done: true };

	let data: any;
	try {
		data = await getBookmarks({ limit: 100, cursor });
	} catch (err: any) {
		console.error('Failed to fetch bookmarks:', err);
		toast.error(`Failed to fetch bookmarks: ${err?.body?.message ?? err?.message ?? err}`);
		return { cursor, done: true };
	}

	const db = getDb();
	const validBookmarks = data.bookmarks.filter((b: any) => b.item?.uri);
	const uris = validBookmarks.map((b: any) => b.item.uri);
	const existingDocs = await db.posts.bulkGet(uris);
	const toPut: any[] = [];
	const now = Date.now();

	for (let j = 0; j < validBookmarks.length; j++) {
		const bookmark = validBookmarks[j];
		const existing = existingDocs[j];

		if (existing) {
			if (existing.sources.includes(source)) {
				if (stopOnExisting) {
					// Already indexed for this source — flush and stop
					if (toPut.length > 0) await db.posts.bulkPut(toPut);
					return { cursor: data.cursor ?? cursor, done: true };
				}
				// Resuming an interrupted fetch — skip already-processed posts
				continue;
			}
			// Exists from another source — add source tag
			toPut.push({ ...existing, sources: [...existing.sources, source], fetchedAt: now });
			indexPost(s.index!, existing);
			s.count++;
			continue;
		}

		// Bookmarks come with full PostView — store directly
		toPut.push({ ...bookmark.item, sources: [source], savedAt: now, fetchedAt: now });
		indexPost(s.index!, bookmark.item);
		s.count++;
	}

	if (toPut.length > 0) await db.posts.bulkPut(toPut);

	const nextCursor = data.bookmarks.length > 0 ? data.cursor : undefined;
	if (nextCursor && nextCursor === cursor) {
		return { cursor: nextCursor, done: true };
	}
	return { cursor: nextCursor, done: !nextCursor };
}

async function loadBookmarks(source: SourceType, myGen: number) {
	if (!user.did || !searchState.sources[source].index) return;

	const { getBookmarks } = await import('$lib/atproto/server/search.remote');

	const db = getDb();
	const s = searchState.sources[source];
	s.phase = 'loading';

	const meta = await db.meta.get(source);

	// Step 1: Fetch new bookmarks from the top until we hit one we already have
	const isResuming = !!meta?.fetchCursor;
	let result = { cursor: meta?.fetchCursor as string | undefined, done: false };
	do {
		result = await fetchBookmarkPage(source, s, getBookmarks, result.cursor, myGen, !isResuming);
		await s.index!.commit();
		if (myGen !== generation) return;
		if (!result.done && result.cursor) {
			await db.meta.put({ ...meta, source, fetchCursor: result.cursor });
		}
	} while (!result.done);

	// Pass 1 complete — clear fetchCursor
	await db.meta.put({ ...meta, source, fetchCursor: undefined });

	// Step 2: Continue from where we left off last time (tail)
	if (meta?.tailCursor) {
		result = { cursor: meta.tailCursor, done: false };
		do {
			result = await fetchBookmarkPage(source, s, getBookmarks, result.cursor, myGen);
			await s.index!.commit();
			if (myGen !== generation) return;
			if (result.cursor) {
				await db.meta.put({ source, tailCursor: result.cursor });
			}
		} while (!result.done);
	}

	// Save final tail position
	if (result.cursor) {
		await db.meta.put({ source, tailCursor: result.cursor });
	} else {
		await db.meta.put({ source, tailCursor: undefined });
	}

	await s.index!.commit();
	s.phase = 'done';
	loadNext(myGen);
}

// --- Replies loading ---

const HOUR = 3_600_000;
const DAY = 86_400_000;

function getRefreshInterval(postAgeMs: number): number {
	if (postAgeMs < 4 * HOUR) return 1 * HOUR;
	if (postAgeMs < 1 * DAY) return 4 * HOUR;
	if (postAgeMs < 3 * DAY) return 12 * HOUR;
	if (postAgeMs < 7 * DAY) return 1 * DAY;
	if (postAgeMs < 30 * DAY) return 3 * DAY;
	return 7 * DAY;
}

async function loadReplies(myGen: number) {
	if (!user.did) return;

	const s = searchState.sources.replies;
	s.phase = 'loading';

	const db = getDb();
	const now = Date.now();

	// Get all user posts from Dexie
	const userPosts = await db.posts.where('sources').equals('posts').toArray();
	if (myGen !== generation) return;

	// Sort newest first
	userPosts.sort((a, b) => {
		const dateA = a.record?.createdAt ? new Date(a.record.createdAt).getTime() : 0;
		const dateB = b.record?.createdAt ? new Date(b.record.createdAt).getTime() : 0;
		return dateB - dateA;
	});

	// Get thread meta for all posts
	const metaEntries = await db.threadMeta.bulkGet(userPosts.map((p) => p.uri));
	const metaMap = new Map<string, { repliesFetchedAt: number }>();
	for (let i = 0; i < userPosts.length; i++) {
		if (metaEntries[i]) metaMap.set(userPosts[i].uri, metaEntries[i]!);
	}

	// Filter to posts needing a refresh
	const fetchQueue: typeof userPosts = [];
	for (const post of userPosts) {
		// Skip posts with zero replies
		if ((post.replyCount ?? 0) === 0) continue;

		const meta = metaMap.get(post.uri);
		if (!meta) {
			fetchQueue.push(post);
			continue;
		}

		const postAge = post.record?.createdAt
			? now - new Date(post.record.createdAt).getTime()
			: Infinity;
		const interval = getRefreshInterval(postAge);
		if (now - meta.repliesFetchedAt >= interval) {
			fetchQueue.push(post);
		}
	}

	// Process in batches of 5
	const BATCH_SIZE = 5;
	let backoff = 1000;

	for (let i = 0; i < fetchQueue.length; i += BATCH_SIZE) {
		if (myGen !== generation) return;

		const batch = fetchQueue.slice(i, i + BATCH_SIZE);
		const results = await Promise.all(
			batch.map((post) =>
				publicClient
					.get('app.bsky.feed.getPostThread', {
						params: { uri: post.uri, depth: 1, parentHeight: 0 } as any
					})
					.catch((e: any) => {
						if (e?.status === 429) return { ok: false, rateLimited: true } as any;
						console.error('Failed to fetch thread:', post.uri, e);
						return null;
					})
			)
		);

		// Check for rate limiting
		const rateLimited = results.some((r: any) => r?.rateLimited);
		if (rateLimited) {
			await new Promise((resolve) => setTimeout(resolve, backoff));
			backoff = Math.min(backoff * 2, 30000);
			i -= BATCH_SIZE; // Retry this batch
			continue;
		}
		backoff = 1000; // Reset backoff on success

		// Collect all reply posts from this batch
		const allReplyPosts: { post: any; parentIdx: number }[] = [];
		const metaToPut: any[] = [];

		for (let j = 0; j < results.length; j++) {
			const result = results[j];
			if (!result?.ok) continue;

			const thread = result.data.thread;
			if (thread.$type !== 'app.bsky.feed.defs#threadViewPost') continue;

			const replies = (thread as any).replies ?? [];
			for (const reply of replies) {
				if (reply.$type !== 'app.bsky.feed.defs#threadViewPost' || !reply.post?.uri) continue;
				allReplyPosts.push({ post: reply.post, parentIdx: j });
			}

			metaToPut.push({ uri: batch[j].uri, repliesFetchedAt: now });
		}

		// Batch-lookup existing posts
		const replyUris = allReplyPosts.map((r) => r.post.uri);
		const existingPosts = await db.posts.bulkGet(replyUris);
		const toPut: any[] = [];

		for (let k = 0; k < allReplyPosts.length; k++) {
			const replyPost = allReplyPosts[k].post;
			const existing = existingPosts[k];

			if (existing) {
				if (!existing.sources.includes('replies')) {
					toPut.push({
						...existing,
						sources: [...existing.sources, 'replies'],
						fetchedAt: now
					});
					indexPost(s.index!, existing);
					s.count++;
				}
			} else {
				toPut.push({ ...replyPost, sources: ['replies'], savedAt: now, fetchedAt: now });
				indexPost(s.index!, replyPost);
				s.count++;
			}
		}

		if (toPut.length > 0) await db.posts.bulkPut(toPut);
		if (metaToPut.length > 0) await db.threadMeta.bulkPut(metaToPut);
		await s.index!.commit();
	}

	s.phase = 'done';
	loadNext(myGen);
}

// --- Filter helpers ---

function hasEmbedType(doc: any, type: string): boolean {
	const embed = doc.embed;
	if (!embed) return false;
	if (embed.$type === type) return true;
	if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
		return embed.media?.$type === type;
	}
	return false;
}

function hasLinkInFacets(doc: any): boolean {
	const facets = doc.record?.facets;
	if (!Array.isArray(facets)) return false;
	return facets.some(
		(f: any) => f.features?.some((feat: any) => feat.$type === 'app.bsky.richtext.facet#link')
	);
}

function applyFilters(results: any[], filters: SearchFilters): any[] {
	let r = results;
	if (filters.handles.length > 0) {
		r = r.filter((item) => {
			const h = item.doc.author?.handle?.toLowerCase();
			return h && filters.handles.some((fh) => h.includes(fh.toLowerCase()));
		});
	}
	if (filters.minLikes > 0) {
		r = r.filter((item) => (item.doc.likeCount ?? 0) >= filters.minLikes);
	}
	if (filters.minReposts > 0) {
		r = r.filter((item) => (item.doc.repostCount ?? 0) >= filters.minReposts);
	}
	if (filters.minReplies > 0) {
		r = r.filter((item) => (item.doc.replyCount ?? 0) >= filters.minReplies);
	}
	if (filters.dateAfter) {
		const after = new Date(filters.dateAfter).getTime();
		r = r.filter((item) => {
			const created = item.doc.record?.createdAt;
			return created && new Date(created).getTime() >= after;
		});
	}
	if (filters.dateBefore) {
		const before = new Date(filters.dateBefore).getTime() + 86400000;
		r = r.filter((item) => {
			const created = item.doc.record?.createdAt;
			return created && new Date(created).getTime() <= before;
		});
	}
	if (filters.hasImage) {
		r = r.filter((item) => hasEmbedType(item.doc, 'app.bsky.embed.images#view'));
	}
	if (filters.hasLink) {
		r = r.filter(
			(item) =>
				hasEmbedType(item.doc, 'app.bsky.embed.external#view') || hasLinkInFacets(item.doc)
		);
	}
	if (filters.hasVideo) {
		r = r.filter((item) => hasEmbedType(item.doc, 'app.bsky.embed.video#view'));
	}
	if (!filters.showReplies) {
		r = r.filter((item) => !item.doc.record?.reply);
	}
	if (filters.onlyReplies) {
		r = r.filter((item) => !!item.doc.record?.reply);
	}
	return r;
}

export function filtersActive(filters: SearchFilters): boolean {
	return (
		filters.handles.length > 0 ||
		filters.minLikes > 0 ||
		filters.minReposts > 0 ||
		filters.minReplies > 0 ||
		!!filters.dateAfter ||
		!!filters.dateBefore ||
		filters.hasImage ||
		filters.hasLink ||
		filters.hasVideo ||
		!filters.showReplies ||
		filters.onlyReplies
	);
}

function sortByDate(items: any[]): any[] {
	return items.sort((a, b) => {
		const dateA = a.doc.record?.createdAt ? new Date(a.doc.record.createdAt).getTime() : 0;
		const dateB = b.doc.record?.createdAt ? new Date(b.doc.record.createdAt).getTime() : 0;
		return dateB - dateA;
	});
}

export async function searchIndex(
	query: string,
	filters: SearchFilters = DEFAULT_FILTERS,
	limit: number = 50
): Promise<{ results: any[]; hasMore: boolean }> {
	const source = searchState.activeSource;
	const hasFilters = filtersActive(filters);
	const db = getDb();

	let docs: any[];

	if (query) {
		// Text search via FlexSearch → get URIs → lookup in Dexie
		const idx = searchState.sources[source].index;
		if (!idx) return { results: [], hasMore: false };

		const raw = await idx.search({
			query,
			merge: true,
			limit: hasFilters ? 5000 : limit + 1
		});

		const uris = raw.map((r: any) => r.id);
		docs = (await db.posts.bulkGet(uris)).filter(Boolean) as any[];
	} else {
		// No query: get all docs for this source from Dexie
		docs = await db.posts.where('sources').equals(source).toArray();
	}

	let wrapped = docs.map((doc) => ({ doc }));
	if (hasFilters) wrapped = applyFilters(wrapped, filters);
	if (!query) wrapped = sortByDate(wrapped);

	const hasMore = wrapped.length > limit;
	return { results: wrapped.slice(0, limit), hasMore };
}

export async function clearSource(source: SourceType) {
	const db = getDb();
	// Remove source tag from all posts, delete orphans
	const posts = await db.posts.where('sources').equals(source).toArray();
	await db.transaction('rw', db.posts, async () => {
		for (const post of posts) {
			const newSources = post.sources.filter((s) => s !== source);
			if (newSources.length === 0) {
				await db.posts.delete(post.uri);
			} else {
				await db.posts.update(post.uri, { sources: newSources });
			}
		}
	});
	await db.meta.delete(source);
	if (source === 'replies') {
		await db.threadMeta.clear();
	}

	searchState.sources[source].index?.clear();
	searchState.sources[source].count = 0;
	searchState.sources[source].phase = 'idle';
}

export function getLink(uri: string, handle: string) {
	const [, , rkey] = uri.replace('at://', '').split('/');
	return `https://bsky.app/profile/${handle}/post/${rkey}`;
}
