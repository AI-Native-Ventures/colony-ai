type VideoReviewReaction = {
  emoji: string;
  emojiUrl?: string;
  count: number;
  reactedByCurrentUser?: boolean;
  users: Array<{
    pubkey: string;
    displayName: string;
    avatarUrl: string | null;
  }>;
};

export type VideoReviewComment = {
  id: string;
  pubkey?: string;
  author: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  body: string;
  createdAt: number;
  time: string;
  /** Parent event id — when it points at another comment, this is a reply. */
  parentId?: string | null;
  reactions?: VideoReviewReaction[];
};
