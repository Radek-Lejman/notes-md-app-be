export interface NoteToIndex {
  id: string;
  userId: string;
  title: string;
  content: string;
  updatedAt: Date;
}

export interface EmbeddedChunk {
  headingPath: string;
  content: string;
  embedding: number[];
}

export interface RagHit {
  noteId: string;
  title: string;
  headingPath: string;
  content: string;
  /** Cosine similarity, 0..1 (higher = closer). */
  score: number;
}

export interface RagIndexStats {
  totalNotes: number;
  indexedNotes: number;
  chunks: number;
}
