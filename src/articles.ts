interface Article {
  id: string;
  title: string;
  content: string;
}

interface ArticleFile {
  scrapedAt: string;
  articles: Article[];
}

export type GlobModules = Record<string, { default: ArticleFile }>;

export function loadLatestJson(modules: GlobModules): ArticleFile {
  const files = Object.values(modules);
  if (files.length === 0) {
    return { scrapedAt: '', articles: [] };
  }
  return files.reduce((latest, current) =>
    new Date(current.default.scrapedAt).getTime() > new Date(latest.default.scrapedAt).getTime() ? current : latest
  ).default;
}

export function getArticleList(articles: Article[]): { id: string; title: string }[] {
  return articles.map(({ id, title }) => ({ id, title }));
}

/** Returns title and content for each given id. Output order follows the input ids array. Missing ids are silently skipped. */
export function getArticleContent(
  articles: Article[],
  ids: string[]
): { title: string; content: string }[] {
  return ids
    .map((id) => articles.find((a) => a.id === id))
    .filter((a): a is Article => a !== undefined)
    .map(({ title, content }) => ({ title, content }));
}

// Loads the latest JSON file from output/ using Vite's import.meta.glob
// Vitest resolves this to {} in the test environment (no matching files), so
// module initialization is safe — tests call the pure helpers directly.
const modules = import.meta.glob('../output/*.json', { eager: true }) as GlobModules;
const latestFile = loadLatestJson(modules);

export function listArticles() {
  return getArticleList(latestFile.articles);
}

export function fetchArticleContent(ids: string[]) {
  return getArticleContent(latestFile.articles, ids);
}
