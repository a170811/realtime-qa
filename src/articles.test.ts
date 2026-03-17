import { describe, it, expect } from 'vitest';
import { getArticleList, getArticleContent, loadLatestJson } from './articles';
import type { GlobModules } from './articles';

const mockModules: GlobModules = {
  '../output/top-articles-2026-01-01T00-00-00.json': {
    default: {
      scrapedAt: '2026-01-01T00:00:00.000Z',
      articles: [
        { id: 'aaa', title: 'Article A', content: 'Content of A' },
        { id: 'bbb', title: 'Article B', content: 'Content of B' },
      ],
    },
  },
  '../output/top-articles-2026-03-01T00-00-00.json': {
    default: {
      scrapedAt: '2026-03-01T00:00:00.000Z',
      articles: [
        { id: 'ccc', title: 'Article C', content: 'Content of C' },
        { id: 'ddd', title: 'Article D', content: 'Content of D' },
      ],
    },
  },
};

describe('loadLatestJson', () => {
  it('returns the articles from the file with the latest scrapedAt', () => {
    const result = loadLatestJson(mockModules);
    expect(result.scrapedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0].id).toBe('ccc');
  });

  it('handles a single file', () => {
    const single: GlobModules = {
      '../output/only.json': {
        default: {
          scrapedAt: '2026-01-01T00:00:00.000Z',
          articles: [{ id: 'x', title: 'X', content: 'CX' }],
        },
      },
    };
    const result = loadLatestJson(single);
    expect(result.articles[0].id).toBe('x');
  });

  it('returns empty ArticleFile when no modules exist', () => {
    const result = loadLatestJson({});
    expect(result).toEqual({ scrapedAt: '', articles: [] });
  });
});

describe('getArticleList', () => {
  it('returns id and title for each article', () => {
    const articles = [
      { id: 'aaa', title: 'Article A', content: 'Content A' },
      { id: 'bbb', title: 'Article B', content: 'Content B' },
    ];
    expect(getArticleList(articles)).toEqual([
      { id: 'aaa', title: 'Article A' },
      { id: 'bbb', title: 'Article B' },
    ]);
  });
});

describe('getArticleContent', () => {
  const articles = [
    { id: 'aaa', title: 'Article A', content: 'Content A' },
    { id: 'bbb', title: 'Article B', content: 'Content B' },
    { id: 'ccc', title: 'Article C', content: 'Content C' },
  ];

  it('returns title and content for matching ids', () => {
    const result = getArticleContent(articles, ['aaa', 'ccc']);
    expect(result).toEqual([
      { title: 'Article A', content: 'Content A' },
      { title: 'Article C', content: 'Content C' },
    ]);
  });

  it('silently skips missing ids', () => {
    const result = getArticleContent(articles, ['aaa', 'zzz']);
    expect(result).toEqual([{ title: 'Article A', content: 'Content A' }]);
  });

  it('returns empty array when no ids match', () => {
    const result = getArticleContent(articles, ['zzz']);
    expect(result).toEqual([]);
  });
});
