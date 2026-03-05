import { user } from '$lib/atproto';
import { toast } from '@foxui/core';
import { Client, simpleFetchHandler } from '@atcute/client';
import {
	getDb,
	extractPostFields,
	upsertAccount,
	postExistsForSource,
	postExists,
	getSourceCount,
	getCursor,
	setCursor,
	bulkUpsertPosts,
	tagExistingPosts,
	searchPosts,
	clearSource as dbClearSource,
	clearAllData as dbClearAllData,
	getAccounts as dbGetAccounts,
	clearAccountData as dbClearAccountData,
	ALL_SOURCES,
	DEFAULT_FILTERS,
	type SourceType,
	type SearchFilters,
	type ExtractedPost
} from '$lib/db';

export { ALL_SOURCES, DEFAULT_FILTERS, type SourceType, type SearchFilters };

export const SOURCE_LABELS: Record<SourceType, string> = {
	likes: 'Likes',
	bookmarks: 'Bookmarks',
	posts: 'Posts',
	reposts: 'Reposts'
};

export function getPlaceholder(sources: SourceType[]): string {
	if (sources.length === ALL_SOURCES.length) return 'Search all posts';
	if (sources.length > 1)
		return `Search ${sources.map((s) => SOURCE_LABELS[s].toLowerCase()).join(' & ')}`;
	if (sources.length === 1) {
		const labels: Record<SourceType, string> = {
			likes: 'Search liked posts',
			bookmarks: 'Search bookmarks',
			posts: 'Search my posts',
			reposts: 'Search reposted posts'
		};
		return labels[sources[0]];
	}
	return 'Select a source to search';
}

type SourceState = {
	count: number;
	indexed: number;
	totalToIndex: number;
	phase: 'idle' | 'fetching' | 'hydrating' | 'done';
	pendingUris: string[];
	pendingIndex: number;
};

function createSourceState(): SourceState {
	return {
		count: 0,
		indexed: 0,
		totalToIndex: 0,
		phase: 'idle',
		pendingUris: [],
		pendingIndex: 0
	};
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
	activeSources: ['likes'] as SourceType[]
});

let generation = 0;

export async function initSources() {
	const db = await getDb();
	const accountDid = user.did;
	if (!accountDid) return;

	// Register/update current account
	await upsertAccount(
		db,
		accountDid,
		user.profile?.handle ?? '',
		user.profile?.displayName,
		user.profile?.avatar
	);

	// Get counts for each source
	for (const source of ALL_SOURCES) {
		searchState.sources[source].count = await getSourceCount(db, accountDid, source);
	}

	// Start loading active source first
	startLoading(searchState.activeSources[0] ?? 'likes');
}

export function toggleSource(source: SourceType) {
	const current = searchState.activeSources;
	if (current.includes(source)) {
		// Don't allow deselecting all
		if (current.length <= 1) return;
		searchState.activeSources = current.filter((s) => s !== source);
	} else {
		searchState.activeSources = [...current, source];
	}

	generation++;
	// Start loading any sources that aren't done yet
	for (const s of searchState.activeSources) {
		if (searchState.sources[s].phase !== 'done') {
			startLoading(s);
			return;
		}
	}
	loadNext(generation);
}

export function setActiveSources(sources: SourceType[]) {
	if (sources.length === 0) return;
	searchState.activeSources = sources;
	generation++;
	for (const s of sources) {
		if (searchState.sources[s].phase !== 'done') {
			startLoading(s);
			return;
		}
	}
	loadNext(generation);
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

	// Prioritize active sources, then others
	const sorted = [
		...searchState.activeSources,
		...ALL_SOURCES.filter((s) => !searchState.activeSources.includes(s))
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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	fetchFn: Function,
	cursor: string | undefined,
	myGen: number
): Promise<{ cursor: string | undefined; done: boolean }> {
	if (myGen !== generation) return { cursor, done: true };

	const accountDid = user.did;
	if (!accountDid) return { cursor, done: true };

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let data: any;
	try {
		data = await fetchFn({ limit: 100, cursor });
	} catch (err) {
		console.error(`Failed to fetch ${source}:`, err);
		toast.error(`Failed to fetch ${source}`);
		return { cursor, done: true };
	}

	const db = await getDb();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const uris = data.records.map((r: any) => (source === 'posts' ? r.uri : r.value.subject.uri));

	// Check which URIs already exist for this source
	const toTag: string[] = [];

	for (let j = 0; j < uris.length; j++) {
		const subjectUri = uris[j];

		if (await postExistsForSource(db, subjectUri, accountDid, source)) {
			// Already indexed for this source — flush tags and stop
			if (toTag.length > 0) {
				const tagged = await tagExistingPosts(db, toTag, accountDid, source);
				s.count += tagged;
			}
			const lastRecord = data.records[j];
			const stopCursor = lastRecord?.uri?.split('/').pop() ?? data.cursor;
			return { cursor: stopCursor, done: true };
		}

		// Check if post exists from another source (already in posts table)
		if (await postExists(db, subjectUri)) {
			toTag.push(subjectUri);
		} else {
			s.pendingUris.push(subjectUri);
		}
	}

	if (toTag.length > 0) {
		const tagged = await tagExistingPosts(db, toTag, accountDid, source);
		s.count += tagged;
	}

	const nextCursor = data.records.length > 0 ? data.cursor : undefined;
	if (nextCursor && nextCursor === cursor) {
		return { cursor: nextCursor, done: true };
	}
	return { cursor: nextCursor, done: !nextCursor };
}

async function loadRecords(source: SourceType, myGen: number) {
	if (!user.did) return;

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
	const db = await getDb();
	const accountDid = user.did;

	if (s.phase === 'idle' || s.phase === 'fetching') {
		s.phase = 'fetching';

		const tailCursor = await getCursor(db, accountDid, source);

		// Step 1: Fetch new posts from the top
		let result = { cursor: undefined as string | undefined, done: false };
		do {
			result = await fetchRecordPage(source, s, fetchFn, result.cursor, myGen);
		} while (!result.done && myGen === generation);

		if (myGen !== generation) return;

		// Step 2: Continue from tail cursor
		if (tailCursor) {
			result = { cursor: tailCursor, done: false };
			do {
				result = await fetchRecordPage(source, s, fetchFn, result.cursor, myGen);
			} while (!result.done && myGen === generation);

			if (myGen !== generation) return;
		}

		// Save cursor progress
		await setCursor(db, accountDid, source, result.cursor);

		s.totalToIndex = s.pendingUris.length;
		s.phase = 'hydrating';
	}

	if (s.phase === 'hydrating') {
		await hydrateUris(source, myGen);
	}
}

async function hydrateUris(source: SourceType, myGen: number) {
	const s = searchState.sources[source];
	const accountDid = user.did;
	if (!accountDid) return;

	const BATCH_SIZE = 25;
	const CONCURRENCY = 5;

	const remaining = s.pendingUris.slice(s.pendingIndex);
	const batches: string[][] = [];
	for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
		batches.push(remaining.slice(i, i + BATCH_SIZE));
	}

	const db = await getDb();

	for (let i = 0; i < batches.length; i += CONCURRENCY) {
		if (myGen !== generation) return;

		const chunk = batches.slice(i, i + CONCURRENCY);
		const results = await Promise.all(
			chunk.map((uris) =>
				publicClient
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					.get('app.bsky.feed.getPosts', { params: { uris: uris as any } })
					.catch((e) => {
						console.error(`Failed to hydrate ${source} batch:`, e);
						return null;
					})
			)
		);

		// Collect all posts from this chunk
		const now = Date.now();
		const extracted: ExtractedPost[] = [];
		for (const result of results) {
			if (result?.ok) {
				for (const post of result.data.posts) {
					extracted.push(extractPostFields(post, now, now));
				}
			}
		}

		if (extracted.length > 0) {
			const count = await bulkUpsertPosts(db, extracted, accountDid, source);
			s.indexed += count;
			s.count += count;
		}

		s.pendingIndex += chunk.reduce((sum, b) => sum + b.length, 0);
	}

	s.phase = 'done';
	loadNext(myGen);
}

async function fetchBookmarkPage(
	source: SourceType,
	s: SourceState,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getBookmarksFn: Function,
	cursor: string | undefined,
	myGen: number
): Promise<{ cursor: string | undefined; done: boolean }> {
	if (myGen !== generation) return { cursor, done: true };

	const accountDid = user.did;
	if (!accountDid) return { cursor, done: true };

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let data: any;
	try {
		data = await getBookmarksFn({ limit: 100, cursor });
	} catch (err: unknown) {
		console.error('Failed to fetch bookmarks:', err);
		const message =
			err && typeof err === 'object' && 'body' in err
				? (err as { body?: { message?: string } }).body?.message
				: err instanceof Error
					? err.message
					: String(err);
		toast.error(`Failed to fetch bookmarks: ${message}`);
		return { cursor, done: true };
	}

	const db = await getDb();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const validBookmarks = data.bookmarks.filter((b: any) => b.item?.uri);
	const now = Date.now();
	const toInsert: ExtractedPost[] = [];
	const toTag: string[] = [];

	for (const bookmark of validBookmarks) {
		const postUri = bookmark.item.uri;

		if (await postExistsForSource(db, postUri, accountDid, source)) {
			// Already indexed — flush and stop
			if (toInsert.length > 0) {
				const count = await bulkUpsertPosts(db, toInsert, accountDid, source);
				s.count += count;
				s.indexed += count;
			}
			if (toTag.length > 0) {
				s.count += await tagExistingPosts(db, toTag, accountDid, source);
			}
			return { cursor: data.cursor ?? cursor, done: true };
		}

		// Check if post exists from another source
		if (await postExists(db, postUri)) {
			toTag.push(postUri);
		} else {
			// Bookmarks come with full PostView
			toInsert.push(extractPostFields(bookmark.item, now, now));
		}
	}

	if (toInsert.length > 0) {
		const count = await bulkUpsertPosts(db, toInsert, accountDid, source);
		s.count += count;
		s.indexed += count;
	}
	if (toTag.length > 0) {
		s.count += await tagExistingPosts(db, toTag, accountDid, source);
	}

	const nextCursor = data.bookmarks.length > 0 ? data.cursor : undefined;
	if (nextCursor && nextCursor === cursor) {
		return { cursor: nextCursor, done: true };
	}
	return { cursor: nextCursor, done: !nextCursor };
}

async function loadBookmarks(source: SourceType, myGen: number) {
	if (!user.did) return;

	const { getBookmarks } = await import('$lib/atproto/server/search.remote');

	const s = searchState.sources[source];
	const db = await getDb();
	const accountDid = user.did;
	s.phase = 'fetching';

	const tailCursor = await getCursor(db, accountDid, source);

	// Step 1: Fetch new bookmarks from the top
	let result = { cursor: undefined as string | undefined, done: false };
	do {
		result = await fetchBookmarkPage(source, s, getBookmarks, result.cursor, myGen);
	} while (!result.done && myGen === generation);

	if (myGen !== generation) return;

	// Step 2: Continue from tail cursor
	if (tailCursor) {
		result = { cursor: tailCursor, done: false };
		do {
			result = await fetchBookmarkPage(source, s, getBookmarks, result.cursor, myGen);
		} while (!result.done && myGen === generation);

		if (myGen !== generation) return;
	}

	await setCursor(db, accountDid, source, result.cursor);

	s.phase = 'done';
	loadNext(myGen);
}

// --- Public search API ---

export { filtersActive } from '$lib/db';

export async function searchIndex(
	query: string,
	filters: SearchFilters = DEFAULT_FILTERS,
	sources: SourceType[] = searchState.activeSources,
	limit: number = 50,
	offset: number = 0
): Promise<{
	results: { doc: unknown; isLiked: boolean; isBookmarked: boolean }[];
	hasMore: boolean;
}> {
	const accountDid = user.did;
	if (!accountDid) return { results: [], hasMore: false };

	const db = await getDb();

	// Get all account DIDs for cross-account search (for now, just current account)
	const accountDids = [accountDid];

	return searchPosts(db, {
		query,
		filters,
		sources,
		accountDids,
		limit,
		offset
	});
}

// --- Clear operations ---

export async function clearSource(source: SourceType) {
	const accountDid = user.did;
	if (!accountDid) return;

	const db = await getDb();
	await dbClearSource(db, accountDid, source);

	searchState.sources[source].count = 0;
	searchState.sources[source].indexed = 0;
	searchState.sources[source].totalToIndex = 0;
	searchState.sources[source].phase = 'idle';
	searchState.sources[source].pendingUris = [];
	searchState.sources[source].pendingIndex = 0;
}

export async function clearAll() {
	const db = await getDb();
	await dbClearAllData(db);

	for (const source of ALL_SOURCES) {
		searchState.sources[source].count = 0;
		searchState.sources[source].indexed = 0;
		searchState.sources[source].totalToIndex = 0;
		searchState.sources[source].phase = 'idle';
		searchState.sources[source].pendingUris = [];
		searchState.sources[source].pendingIndex = 0;
	}
}

export async function clearAccount(accountDid: string) {
	const db = await getDb();
	await dbClearAccountData(db, accountDid);

	// If clearing current account, reset state
	if (accountDid === user.did) {
		for (const source of ALL_SOURCES) {
			searchState.sources[source].count = 0;
			searchState.sources[source].indexed = 0;
			searchState.sources[source].totalToIndex = 0;
			searchState.sources[source].phase = 'idle';
			searchState.sources[source].pendingUris = [];
			searchState.sources[source].pendingIndex = 0;
		}
	}
}

export async function listAccounts(): Promise<
	{ did: string; handle: string; display_name: string | null }[]
> {
	const db = await getDb();
	return dbGetAccounts(db);
}
