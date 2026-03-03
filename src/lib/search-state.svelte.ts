import { user } from '$lib/atproto';
import { toast } from '@foxui/core';
import { Document, Charset, IndexedDB } from 'flexsearch';
import { Client, simpleFetchHandler } from '@atcute/client';

export type SourceType = 'likes' | 'bookmarks' | 'posts';

export const SOURCE_LABELS: Record<SourceType, string> = {
	likes: 'Likes',
	bookmarks: 'Bookmarks',
	posts: 'Posts'
};

export const PLACEHOLDERS: Record<SourceType, string> = {
	likes: 'Search liked posts',
	bookmarks: 'Search bookmarks',
	posts: 'Search my posts'
};

export const ALL_SOURCES: SourceType[] = ['likes', 'bookmarks', 'posts'];

type SourceState = {
	knownIds: Set<string>;
	index: Document | null;
	count: number;
	indexed: number;
	totalToIndex: number;
	phase: 'idle' | 'fetching' | 'hydrating' | 'done';
	cursor?: string;
	pendingUris: string[];
	pendingIndex: number;
};

function createSourceState(): SourceState {
	return {
		knownIds: new Set(),
		index: null,
		count: 0,
		indexed: 0,
		totalToIndex: 0,
		phase: 'idle',
		cursor: undefined,
		pendingUris: [],
		pendingIndex: 0
	};
}

function createIndex() {
	return new Document({
		document: {
			id: 'uri',
			store: true,
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
			],
			tag: [
				{ field: 'likeCount' },
				{ field: 'replyCount' },
				{ field: 'author:handle' },
				{ field: 'author:displayName' }
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
		posts: createSourceState()
	} as Record<SourceType, SourceState>,
	activeSource: 'likes' as SourceType,
	loading: true
});

let generation = 0;

function loadKnownIds(source: SourceType) {
	const ids = localStorage.getItem(`${source}-ids`);
	if (ids) {
		searchState.sources[source].knownIds = new Set(ids.split(','));
	}
	searchState.sources[source].count = searchState.sources[source].knownIds.size;
}

function addKnownId(source: SourceType, id: string) {
	searchState.sources[source].knownIds.add(id);
	localStorage.setItem(
		`${source}-ids`,
		Array.from(searchState.sources[source].knownIds).join(',')
	);
	searchState.sources[source].count = searchState.sources[source].knownIds.size;
}

export function clearSource(source: SourceType) {
	searchState.sources[source].knownIds.clear();
	localStorage.removeItem(`${source}-ids`);
	localStorage.removeItem(`${source}-cursor`);
	searchState.sources[source].count = 0;
	searchState.sources[source].indexed = 0;
	searchState.sources[source].totalToIndex = 0;
	searchState.sources[source].phase = 'idle';
	searchState.sources[source].cursor = undefined;
	searchState.sources[source].pendingUris = [];
	searchState.sources[source].pendingIndex = 0;
	searchState.sources[source].index?.clear();
}

export async function initSources() {
	for (const source of ALL_SOURCES) {
		const db = new IndexedDB(`${source}-store`);
		searchState.sources[source].index = createIndex();
		await searchState.sources[source].index!.mount(db);
		loadKnownIds(source);
	}

	searchState.loading = false;
	startLoading('likes');
}

export function switchSource(source: SourceType) {
	if (source === searchState.activeSource) return;
	searchState.activeSource = source;
	// Bump generation to cancel any in-flight loading
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

async function loadRecords(source: SourceType, myGen: number) {
	if (!user.did || !searchState.sources[source].index) return;

	const { listLikeRecords, listPostRecords } = await import(
		'$lib/atproto/server/search.remote'
	);
	const fetchFn = source === 'likes' ? listLikeRecords : listPostRecords;

	const s = searchState.sources[source];

	// Phase 1: Fetch records if not already done
	if (s.phase === 'idle' || s.phase === 'fetching') {
		s.phase = 'fetching';

		let cursor = s.cursor;
		let found = false;
		let data: any;

		do {
			if (myGen !== generation) return;

			try {
				data = await fetchFn({ limit: 100, cursor });
			} catch (err) {
				console.error(`Failed to fetch ${source}:`, err);
				toast.error(`Failed to fetch ${source}`);
				return;
			}

			cursor = data.cursor;

			for (const record of data.records) {
				const subjectUri = source === 'likes' ? record.value.subject.uri : record.uri;
				if (!s.knownIds.has(subjectUri)) {
					addKnownId(source, subjectUri);
					s.pendingUris.push(subjectUri);
					continue;
				}

				found = true;
				cursor = localStorage.getItem(`${source}-cursor`) ?? undefined;

				if (cursor) {
					localStorage.removeItem(`${source}-cursor`);
					found = false;
				}

				break;
			}

			if (cursor && data.records.length > 0) {
				localStorage.setItem(`${source}-cursor`, cursor);
				s.cursor = cursor;
			} else {
				localStorage.removeItem(`${source}-cursor`);
				s.cursor = undefined;
			}
		} while (cursor && data.records.length > 0 && !found);

		s.totalToIndex = s.pendingUris.length;
		s.phase = 'hydrating';
	}

	// Phase 2: Hydrate with getPosts
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

		for (const result of results) {
			if (result?.ok) {
				for (const post of result.data.posts) {
					s.index!.add(post as any);
					s.indexed++;
				}
			}
		}

		s.pendingIndex += chunk.reduce((sum, b) => sum + b.length, 0);
		await s.index!.commit();
	}

	s.phase = 'done';
	loadNext(myGen);
}

async function loadBookmarks(source: SourceType, myGen: number) {
	if (!user.did || !searchState.sources[source].index) return;

	const { getBookmarks } = await import('$lib/atproto/server/search.remote');

	const s = searchState.sources[source];
	s.phase = 'fetching';

	let cursor = s.cursor;
	let found = false;
	let data: any;

	do {
		if (myGen !== generation) return;

		try {
			data = await getBookmarks({ limit: 100, cursor });
		} catch (err: any) {
			console.error('Failed to fetch bookmarks:', err);
			toast.error(`Failed to fetch bookmarks: ${err?.body?.message ?? err?.message ?? err}`);
			return;
		}

		cursor = data.cursor;

		for (const bookmark of data.bookmarks) {
			// item can be PostView, BlockedPost, or NotFoundPost — only index PostView
			if (!bookmark.item?.uri) continue;

			const postUri = bookmark.item.uri;
			if (!s.knownIds.has(postUri)) {
				addKnownId(source, postUri);
				s.index!.add(bookmark.item as any);
				s.indexed++;
				s.count = s.knownIds.size;
				continue;
			}

			found = true;
			cursor = localStorage.getItem(`${source}-cursor`) ?? undefined;

			if (cursor) {
				localStorage.removeItem(`${source}-cursor`);
				found = false;
			}

			break;
		}

		if (cursor && data.bookmarks.length > 0) {
			localStorage.setItem(`${source}-cursor`, cursor);
			s.cursor = cursor;
		} else {
			localStorage.removeItem(`${source}-cursor`);
			s.cursor = undefined;
		}
	} while (cursor && data.bookmarks.length > 0 && !found);

	await s.index!.commit();
	s.phase = 'done';
	loadNext(myGen);
}

export async function searchIndex(query: string): Promise<any[]> {
	const idx = searchState.sources[searchState.activeSource].index;
	if (!idx || !query) return [];

	return idx.search({
		query,
		enrich: true,
		merge: true,
		limit: 20
	});
}

export function getLink(uri: string, handle: string) {
	const [, , rkey] = uri.replace('at://', '').split('/');
	return `https://bsky.app/profile/${handle}/post/${rkey}`;
}
