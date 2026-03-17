# QA Bot Design

## Overview

Transform the existing DemoBot (Greeter + Weather Agent demo) into a voice-based QA bot that answers questions using articles scraped from the `output/` folder. The bot uses OpenAI's Realtime API for voice interaction and retrieves answers strictly from article content — never fabricating information.

## Architecture

A single `RealtimeAgent` (QA Agent) replaces the existing greeter and weather agents. The session starts directly with this agent.

```
src/
  main.ts       — QA Agent definition, tools, and session wiring
  utils.ts      — UI button logic (unchanged)
  articles.ts   — Article loading logic using import.meta.glob
  style.css     — Unchanged
```

## Components

### `src/articles.ts`

Responsible for loading article data at runtime using Vite's `import.meta.glob` to bundle all `output/*.json` files at build time.

- Uses the glob pattern `'../output/*.json'` (relative to `src/articles.ts`) with `{ eager: true }`, where each module's default export is the parsed JSON object
- Finds the JSON file with the latest `scrapedAt` timestamp
- Exposes two functions used by the tools:
  - `getArticleList()`: returns `{ id: string, title: string }[]`
  - `getArticleContent(ids: string[])`: returns `{ title: string, content: string }[]` for the given IDs. The `id` field is an opaque string (MongoDB ObjectId) passed through from the JSON as-is; no validation or transformation is needed.

### `src/main.ts`

Defines two tools and one QA Agent, then connects the session.

**Tool: `listArticles`**
- Parameters: `z.object({})` (no parameters)
- Calls `getArticleList()` and returns the list of article IDs and titles

**Tool: `getArticleContent`**
- Parameters: `z.object({ ids: z.array(z.string()) })`
- Calls `getArticleContent(ids)` and returns title + content for each

**Session Setup**

`RealtimeSession` is constructed with `qaAgent`. The `transport_event` listener is retained to keep the event log UI functional. Button handlers (connect, disconnect, mute) remain unchanged.

Note: calling `listArticles` on every user turn adds one round-trip of latency before the agent can speak. This is acceptable given the small article count and the simplicity preference of this project.

**Agent: `qaAgent`**
- Instructions enforce the QA flow:
  1. On receiving a user question, call `listArticles` to get available titles
  2. If relevant articles exist, call `getArticleContent` and answer using only that content
  3. If no relevant articles exist, tell the user there is no available information to answer the question
  4. Never speculate or fabricate information not present in the articles

## Data Flow

```
User asks question (voice)
  → qaAgent calls listArticles tool
  → articles.ts returns title list from latest output/*.json
  → qaAgent evaluates relevance
    → relevant: qaAgent calls getArticleContent tool
               → articles.ts returns content
               → qaAgent answers based on content only
    → not relevant: qaAgent says it cannot answer
```

## Error Handling

- If `output/` contains no JSON files, `getArticleList()` returns an empty array. The agent will respond that it has no available information.
- If a requested article ID is not found, `getArticleContent` skips it silently and returns only what was found.

## Data Format

Each JSON file in `output/` follows this structure:
```json
{
  "scrapedAt": "ISO timestamp",
  "articles": [
    {
      "id": "string",
      "title": "string",
      "content": "string",
      ...
    }
  ]
}
```

The latest file is selected by comparing `scrapedAt` values across all bundled JSON files.

## Constraints

- The bot only reads the single latest JSON file (not all files combined)
- Article data is bundled at build time via `import.meta.glob`; updating data requires restarting the dev server
- The bot must not answer questions outside the scope of available articles
