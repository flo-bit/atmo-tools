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
}

export const db = new Dexie('atmo') as Dexie & {
	posts: EntityTable<StoredPost, 'uri'>;
	meta: EntityTable<SourceMeta, 'source'>;
};

db.version(1).stores({
	posts: 'uri, *sources, savedAt, fetchedAt, likeCount, repostCount, replyCount',
	meta: 'source'
});
