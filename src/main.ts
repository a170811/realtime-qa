import './style.css';
import {
  connectButton,
  disconnectButton,
  muteButton,
  setUIState,
  setSpeaking,
  showError,
  hideError,
  showCitations,
} from './utils';

import { z } from 'zod';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents-realtime';
import { OpenAIRealtimeWebRTC, OpenAIRealtimeWebSocket } from '@openai/agents-realtime';
import { startAudio, stopAudio, setMuted, isMuted } from './ws-audio';

const useWebSocket = import.meta.env.VITE_TRANSPORT === 'websocket';
import { listArticles, fetchArticleContent } from './articles';

// --- Tools ---
const listArticlesTool = tool({
  name: 'listArticles',
  description: 'Returns an array of { id, title } objects representing available articles. Always call this first before answering. Use the id values from this response as input to getArticleContent.',
  parameters: z.object({}),
  execute: () => listArticles(),
});

const getArticleContentTool = tool({
  name: 'getArticleContent',
  description: 'Returns the full title and content for each article. The ids parameter must contain exact id values returned by listArticles. Missing ids are silently skipped.',
  parameters: z.object({
    ids: z.array(z.string()),
  }),
  execute: ({ ids }) => {
    const results = fetchArticleContent(ids);
    showCitations(results);
    return results;
  },
});

// --- Agent ---
const qaAgent = new RealtimeAgent({
  name: 'QA Assistant',
  instructions: `你是一個專業的 QA 助理，只能根據現有文章內容回答問題。

回答流程：
1. 收到使用者問題時，先呼叫 listArticles 取得所有文章標題
2. 判斷是否有相關文章：
   - 有：呼叫 getArticleContent 取得內容，僅根據文章內容回答
   - 無：直接告知使用者「目前沒有相關資料可以回答這個問題」
3. 絕對不可以憑空推測或編造不在文章中的資訊

p.s. 回覆使用者時，請自然地回答就好，不要讓使用者感覺到你在翻閱資料，或讓他們知道你正在查閱資料，這樣會降低使用者對你的信任感。

相關的處理原則如下：
  1. 如果有相對應的資料，就正常回答使用者。
  2. 如果沒有相對應的資料，直接說明無法回答問題即可。

  不需要告訴使用者資料查不到，或是列出現在有哪些資料可供參考，這些都沒有必要。
`,
  tools: [listArticlesTool, getArticleContentTool],
});

// --- Session (created on connect) ---
let session: RealtimeSession | null = null;

async function fetchToken(): Promise<{ token: string; baseUrl?: string }> {
  const res = await fetch('/api/token');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch token');
  return data;
}

// --- Button handlers ---
connectButton.addEventListener('click', async () => {
  hideError();
  setUIState('connecting');

  try {
    const { token, baseUrl } = await fetchToken();

    session = new RealtimeSession(qaAgent, {
      ...(useWebSocket
        ? baseUrl
          ? {
              transport: new OpenAIRealtimeWebSocket({
                url: `${baseUrl.replace(/\/+$/, '')}/v1/realtime`,
              }),
            }
          : { transport: 'websocket' as const }
        : baseUrl
          ? {
              transport: new OpenAIRealtimeWebRTC({
                baseUrl: `${baseUrl.replace(/\/+$/, '')}/v1/realtime/calls`,
              }),
            }
          : {}),
      ...(useWebSocket && {
        config: {
          audio: {
            input: { format: 'pcm16' },
            output: { format: 'pcm16' },
          },
        },
      }),
    });

    // Track AI speaking state for waveform color
    session.on('transport_event', (event) => {
      if (event.type === 'response.audio.delta') {
        setSpeaking(true);
      } else if (event.type === 'response.audio.done') {
        setSpeaking(false);
      }
    });

    await session.connect({ apiKey: token });
    if (useWebSocket) {
      await startAudio(session);
    }
    setUIState('unmuted');
  } catch (err) {
    console.error('Connection failed:', err);
    showError(`連線失敗：${err instanceof Error ? err.message : err}`);
    session = null;
    setUIState('disconnected');
  }
});

disconnectButton.addEventListener('click', () => {
  if (useWebSocket) stopAudio();
  session?.close();
  session = null;
  setUIState('disconnected');
});

muteButton.addEventListener('click', () => {
  if (!session) return;
  if (useWebSocket) {
    const newMutedState = !isMuted();
    setMuted(newMutedState);
    setUIState(newMutedState ? 'muted' : 'unmuted');
  } else {
    const newMutedState = !session.muted;
    session.mute(newMutedState);
    setUIState(newMutedState ? 'muted' : 'unmuted');
  }
});
