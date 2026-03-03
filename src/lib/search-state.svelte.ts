import { user } from '$lib/atproto';
import { toast } from '@foxui/core';
import { Document, Charset, IndexedDB } from 'flexsearch';
import { Client, simpleFetchHandler } from '@atcute/client';
import { db, type StoredPost } from '$lib/db';

export type SourceType = 'likes' | 'bookmarks' | 'posts' | 'reposts';

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
	showReplies: true
};

export const SOURCE_LABELS: Record<SourceType, string> = {
	likes: 'Likes',
	bookmarks: 'Bookmarks',
	posts: 'Posts',
	reposts: 'Reposts'
};

export const PLACEHOLDERS: Record<SourceType, string> = {
	likes: 'Search liked posts',
	bookmarks: 'Search bookmarks',
	posts: 'Search my posts',
	reposts: 'Search reposted posts'
};

export const ALL_SOURCES: SourceType[] = ['likes', 'bookmarks', 'posts', 'reposts'];

type SourceState = {
	index: Document | null;
	count: number;
	indexed: number;
	totalToIndex: number;
	phase: 'idle' | 'fetching' | 'hydrating' | 'done';
	pendingUris: string[];
	pendingIndex: number;
};

function createSourceState(): SourceState {
	return {
		index: null,
		count: 0,
		indexed: 0,
		totalToIndex: 0,
		phase: 'idle',
		pendingUris: [],
		pendingIndex: 0
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
				}
			]
		}
	});
}

const publicClient = new Client({
	handler: simpleFetchHandler({ service: 'https://public.api.bsky.app' })
});

export const searchState = $state({
	sources: {
		likes: createSourceState(),
		bookmarks: createSourceState(),
		posts: createSourceState(),
		reposts: createSourceState()
	} as Record<SourceType, SourceState>,
	activeSource: 'likes' as SourceType
});

let generation = 0;

export async function initSources() {
	// Clean up legacy localStorage data
	for (const source of ALL_SOURCES) {
		localStorage.removeItem(`${source}-ids`);
		localStorage.removeItem(`${source}-cursor`);
	}

	await Promise.all(
		ALL_SOURCES.map(async (source) => {
			const flexDb = new IndexedDB(`${source}-idx`);
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

async function fetchRecordPage(
	source: SourceType,
	s: SourceState,
	fetchFn: Function,
	cursor: string | undefined,
	myGen: number
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
	const existingDocs = await db.posts.bulkGet(uris);
	const toUpdate: any[] = [];
	const now = Date.now();

	for (let j = 0; j < uris.length; j++) {
		const subjectUri = uris[j];
		const existing = existingDocs[j];

		if (existing) {
			if (existing.sources.includes(source)) {
				// Already indexed for this source — flush updates and stop
				if (toUpdate.length > 0) await db.posts.bulkPut(toUpdate);
				return { cursor: data.cursor, done: true };
			}
			// Post exists from another source — queue source tag update
			toUpdate.push({ ...existing, sources: [...existing.sources, source], fetchedAt: now });
			s.index!.add(existing as any);
			s.count++;
			continue;
		}

		s.pendingUris.push(subjectUri);
	}

	if (toUpdate.length > 0) await db.posts.bulkPut(toUpdate);

	const nextCursor = data.records.length > 0 ? data.cursor : undefined;
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

	if (s.phase === 'idle' || s.phase === 'fetching') {
		s.phase = 'fetching';

		const meta = await db.meta.get(source);

		// Step 1: Fetch new posts from the top until we hit one we already have
		let result = { cursor: undefined as string | undefined, done: false };
		do {
			result = await fetchRecordPage(source, s, fetchFn, result.cursor, myGen);
		} while (!result.done && myGen === generation);

		if (myGen !== generation) return;

		// Step 2: Continue from where we left off last time (tail)
		if (meta?.tailCursor) {
			result = { cursor: meta.tailCursor, done: false };
			do {
				result = await fetchRecordPage(source, s, fetchFn, result.cursor, myGen);
			} while (!result.done && myGen === generation);

			if (myGen !== generation) return;
		}

		// Save how far we got into the past
		if (result.cursor) {
			await db.meta.put({ source, tailCursor: result.cursor });
		} else {
			// We've reached the very end — no tail cursor needed
			await db.meta.put({ source, tailCursor: undefined });
		}

		s.totalToIndex = s.pendingUris.length;
		s.phase = 'hydrating';
	}

	if (s.phase === 'hydrating') {
		await hydrateUris(source, myGen);
	}
}

async function hydrateUris(source: SourceType, myGen: number) {
	const s = searchState.sources[source];
	const BATCH_SIZE = 25;
	const CONCURRENCY = 5;

	const remaining = s.pendingUris.slice(s.pendingIndex);
	const batches: string[][] = [];
	for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
		batches.push(remaining.slice(i, i + BATCH_SIZE));
	}

	for (let i = 0; i < batches.length; i += CONCURRENCY) {
		if (myGen !== generation) return;

		const chunk = batches.slice(i, i + CONCURRENCY);
		const results = await Promise.all(
			chunk.map((uris) =>
				publicClient
					.get('app.bsky.feed.getPosts', { params: { uris: uris as any } })
					.catch((e) => {
						console.error(`Failed to hydrate ${source} batch:`, e);
						return null;
					})
			)
		);

		// Collect all posts from this chunk
		const allPosts: any[] = [];
		for (const result of results) {
			if (result?.ok) {
				allPosts.push(...result.data.posts);
			}
		}

		if (allPosts.length > 0) {
			// Batch-check which already exist in Dexie
			const uris = allPosts.map((p) => p.uri);
			const existing = await db.posts.bulkGet(uris);
			const existingMap = new Map<string, StoredPost>();
			for (const doc of existing) {
				if (doc) existingMap.set(doc.uri, doc);
			}

			// Build batch for bulkPut
			const now = Date.now();
			const toPut: any[] = [];
			for (const post of allPosts) {
				const ex = existingMap.get(post.uri);
				if (ex) {
					toPut.push({ ...post, sources: [...ex.sources, source], savedAt: ex.savedAt, fetchedAt: now });
				} else {
					toPut.push({ ...post, sources: [source], savedAt: now, fetchedAt: now });
				}
				s.index!.add(post as any);
				s.indexed++;
				s.count++;
			}

			await db.posts.bulkPut(toPut);
		}

		s.pendingIndex += chunk.reduce((sum, b) => sum + b.length, 0);
		await s.index!.commit();
	}

	s.phase = 'done';
	loadNext(myGen);
}

async function fetchBookmarkPage(
	source: SourceType,
	s: SourceState,
	getBookmarks: Function,
	cursor: string | undefined,
	myGen: number
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

	const validBookmarks = data.bookmarks.filter((b: any) => b.item?.uri);
	const uris = validBookmarks.map((b: any) => b.item.uri);
	const existingDocs = await db.posts.bulkGet(uris);
	const toPut: any[] = [];
	const now = Date.now();

	for (let j = 0; j < validBookmarks.length; j++) {
		const bookmark = validBookmarks[j];
		const postUri = uris[j];
		const existing = existingDocs[j];

		if (existing) {
			if (existing.sources.includes(source)) {
				// Already indexed for this source — flush and stop
				if (toPut.length > 0) await db.posts.bulkPut(toPut);
				return { cursor: data.cursor, done: true };
			}
			// Exists from another source — queue tag update
			toPut.push({ ...existing, sources: [...existing.sources, source], fetchedAt: now });
			s.index!.add(existing as any);
			s.count++;
			continue;
		}

		// Bookmarks come with full PostView — queue for batch write
		toPut.push({ ...bookmark.item, sources: [source], savedAt: now, fetchedAt: now });
		s.index!.add(bookmark.item as any);
		s.indexed++;
		s.count++;
	}

	if (toPut.length > 0) await db.posts.bulkPut(toPut);

	const nextCursor = data.bookmarks.length > 0 ? data.cursor : undefined;
	return { cursor: nextCursor, done: !nextCursor };
}

async function loadBookmarks(source: SourceType, myGen: number) {
	if (!user.did || !searchState.sources[source].index) return;

	const { getBookmarks } = await import('$lib/atproto/server/search.remote');

	const s = searchState.sources[source];
	s.phase = 'fetching';

	const meta = await db.meta.get(source);

	// Step 1: Fetch new bookmarks from the top until we hit one we already have
	let result = { cursor: undefined as string | undefined, done: false };
	do {
		result = await fetchBookmarkPage(source, s, getBookmarks, result.cursor, myGen);
		await s.index!.commit();
	} while (!result.done && myGen === generation);

	if (myGen !== generation) return;

	// Step 2: Continue from where we left off last time (tail)
	if (meta?.tailCursor) {
		result = { cursor: meta.tailCursor, done: false };
		do {
			result = await fetchBookmarkPage(source, s, getBookmarks, result.cursor, myGen);
			await s.index!.commit();
		} while (!result.done && myGen === generation);

		if (myGen !== generation) return;
	}

	// Save how far we got into the past
	if (result.cursor) {
		await db.meta.put({ source, tailCursor: result.cursor });
	} else {
		await db.meta.put({ source, tailCursor: undefined });
	}

	await s.index!.commit();
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
		!filters.showReplies
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

	searchState.sources[source].index?.clear();
	searchState.sources[source].count = 0;
	searchState.sources[source].indexed = 0;
	searchState.sources[source].totalToIndex = 0;
	searchState.sources[source].phase = 'idle';
	searchState.sources[source].pendingUris = [];
	searchState.sources[source].pendingIndex = 0;
}

export function getLink(uri: string, handle: string) {
	const [, , rkey] = uri.replace('at://', '').split('/');
	return `https://bsky.app/profile/${handle}/post/${rkey}`;
}
