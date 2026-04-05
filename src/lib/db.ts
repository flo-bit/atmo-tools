import Dexie, { type EntityTable } from 'dexie';

export interface StoredPost {
	uri: string;
	sources: string[];
	savedAt: number;
	fetchedAt: number;
	// PostView fields stored inline
	[key: string]: any;
}

export interface SourceMeta {
	source: string;
	tailCursor?: string; // deepest point reached paginating into the past
	fetchCursor?: string; // resume point for "new from top" pass (set = interrupted)
}

export interface ThreadMeta {
	uri: string; // the user's own post URI
	repliesFetchedAt: number; // Date.now() of last getPostThread call
}

type AtmoDb = Dexie & {
	posts: EntityTable<StoredPost, 'uri'>;
	meta: EntityTable<SourceMeta, 'source'>;
	threadMeta: EntityTable<ThreadMeta, 'uri'>;
};

let currentDb: AtmoDb | null = null;

export function openDb(did: string): AtmoDb {
	if (currentDb) {
		if (currentDb.name === `atmo-${did}`) return currentDb;
		currentDb.close();
	}

	const instance = new Dexie(`atmo-${did}`) as AtmoDb;
	instance.version(1).stores({
		posts: 'uri, *sources, savedAt, fetchedAt, likeCount, repostCount, replyCount',
		meta: 'source'
	});
	instance.version(2).stores({
		posts: 'uri, *sources, savedAt, fetchedAt, likeCount, repostCount, replyCount',
		meta: 'source',
		threadMeta: 'uri'
	});

	currentDb = instance;
	return instance;
}

export function getDb(): AtmoDb {
	if (!currentDb) throw new Error('Database not initialized — call openDb(did) first');
	return currentDb;
}
