export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ArxivPaper = {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  pdfUrl: string;
  published: string;
};

export type TopicVector = {
  name: string;
  embed: number[];
};

export type ScoredPaper = ArxivPaper & {
  score: number;
  topic: string;
  embedding: number[];
};

export type EnrichedPaper = ScoredPaper & {
  tldr: string;
  why: string;
};
