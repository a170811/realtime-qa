# WebSocket Transport Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebSocket as an environment-variable-controlled alternative transport to the existing WebRTC-based realtime voice assistant.

**Architecture:** Conditional branch in `main.ts` selects transport based on `VITE_TRANSPORT` env var. A new `ws-audio.ts` module handles microphone capture (Web Audio API + AudioWorklet) and audio playback for WebSocket mode. WebRTC path is unchanged.

**Tech Stack:** `@openai/agents-realtime` (OpenAIRealtimeWebSocket), Web Audio API, AudioWorklet, Vite env vars

**Spec:** `docs/superpowers/specs/2026-03-20-websocket-transport-design.md`

---

## File Structure

| File | Role |
|---|---|
| `.env.example` | Add `VITE_TRANSPORT` documentation |
| `src/ws-audio.ts` | **New** — mic capture, audio playback, mute state for WebSocket mode |
| `src/main.ts` | Add transport selection, WebSocket audio lifecycle, mute branching |

---

### Task 1: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add VITE_TRANSPORT to .env.example**

Add the new env var with a comment:

```
# Transport: "webrtc" (default) or "websocket"
# VITE_TRANSPORT=webrtc
```

Keep it commented out so the default (webrtc) applies when unset.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add VITE_TRANSPORT to .env.example"
```

---

### Task 2: Create ws-audio.ts — Microphone Capture

**Files:**
- Create: `src/ws-audio.ts`

This task builds the mic input half of the module. Audio playback is Task 3.

- [ ] **Step 1: Create ws-audio.ts with module state and AudioWorklet processor**

```ts
import type { RealtimeSession } from '@openai/agents-realtime';

// --- Module state ---
let micContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;
let playbackContext: AudioContext | null = null;
let currentSession: RealtimeSession | null = null;
let muted = false;
let nextPlayTime = 0;

// --- AudioWorklet processor source ---
const WORKLET_PROCESSOR = `
class Pcm16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    const int16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}
registerProcessor('pcm16-processor', Pcm16Processor);
`;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
}
```

- [ ] **Step 2: Add startAudio function (mic capture only for now)**

Append to `ws-audio.ts`:

```ts
export async function startAudio(session: RealtimeSession): Promise<void> {
  currentSession = session;
  muted = false;

  // Mic capture
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micContext = new AudioContext({ sampleRate: 24000 });
  await micContext.resume();

  const blob = new Blob([WORKLET_PROCESSOR], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(blob);
  await micContext.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  workletNode = new AudioWorkletNode(micContext, 'pcm16-processor');
  workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (!muted && currentSession) {
      currentSession.sendAudio(e.data);
    }
  };

  const source = micContext.createMediaStreamSource(micStream);
  source.connect(workletNode);
  // Don't connect workletNode to destination — we don't want to hear our own mic
}
```

- [ ] **Step 3: Add stopAudio function**

Append to `ws-audio.ts`:

```ts
export function stopAudio(): void {
  workletNode?.disconnect();
  workletNode = null;

  micContext?.close().catch(() => {});
  micContext = null;

  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;

  playbackContext?.close().catch(() => {});
  playbackContext = null;

  currentSession = null;
  muted = false;
  nextPlayTime = 0;
}
```

- [ ] **Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors (ws-audio.ts compiles cleanly)

- [ ] **Step 5: Commit**

```bash
git add src/ws-audio.ts
git commit -m "feat: add ws-audio module with mic capture via AudioWorklet"
```

---

### Task 3: Add Audio Playback to ws-audio.ts

**Files:**
- Modify: `src/ws-audio.ts`

- [ ] **Step 1: Add playback setup inside startAudio**

Add the following at the end of `startAudio`, after mic setup:

```ts
  // Audio playback
  playbackContext = new AudioContext({ sampleRate: 24000 });
  await playbackContext.resume();
  nextPlayTime = 0;

  session.on('audio', (event) => {
    if (!playbackContext) return;

    const int16 = new Int16Array(event.data);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x7FFF;
    }

    const buffer = playbackContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);

    const now = playbackContext.currentTime;
    const startTime = nextPlayTime > now ? nextPlayTime : now;
    source.start(startTime);
    nextPlayTime = startTime + buffer.duration;
  });

  session.on('audio_done', () => {
    nextPlayTime = 0;
  });

  session.on('audio_interrupted', () => {
    nextPlayTime = 0;
    // Recreate playback context to flush queued audio
    const oldCtx = playbackContext;
    playbackContext = new AudioContext({ sampleRate: 24000 });
    playbackContext.resume();
    oldCtx?.close().catch(() => {});
  });
```

- [ ] **Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ws-audio.ts
git commit -m "feat: add audio playback and barge-in support to ws-audio"
```

---

### Task 4: Update main.ts — Transport Selection and Audio Lifecycle

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports and transport flag**

At the top of `main.ts`, add the WebSocket import and transport flag. Replace the existing `OpenAIRealtimeWebRTC` import line:

Replace:
```ts
import { OpenAIRealtimeWebRTC } from '@openai/agents-realtime';
```

With:
```ts
import { OpenAIRealtimeWebRTC, OpenAIRealtimeWebSocket } from '@openai/agents-realtime';
import { startAudio, stopAudio, setMuted, isMuted } from './ws-audio';

const useWebSocket = import.meta.env.VITE_TRANSPORT === 'websocket';
```

- [ ] **Step 2: Update session creation in connect handler**

Replace the session creation block (lines 80-86):

```ts
    session = new RealtimeSession(qaAgent, {
      ...(baseUrl && {
        transport: new OpenAIRealtimeWebRTC({
          baseUrl: `${baseUrl.replace(/\/+$/, '')}/v1/realtime/calls`,
        }),
      }),
    });
```

With:

```ts
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
```

- [ ] **Step 3: Add startAudio call after connect**

After `await session.connect({ apiKey: token });` (line 97), add:

```ts
    if (useWebSocket) {
      await startAudio(session);
    }
```

- [ ] **Step 4: Update disconnect handler**

Replace the disconnect handler (lines 107-111):

```ts
disconnectButton.addEventListener('click', () => {
  session?.close();
  session = null;
  setUIState('disconnected');
});
```

With:

```ts
disconnectButton.addEventListener('click', () => {
  if (useWebSocket) stopAudio();
  session?.close();
  session = null;
  setUIState('disconnected');
});
```

- [ ] **Step 5: Update mute handler**

Replace the mute handler (lines 113-118):

```ts
muteButton.addEventListener('click', () => {
  if (!session) return;
  const newMutedState = !session.muted;
  session.mute(newMutedState);
  setUIState(newMutedState ? 'muted' : 'unmuted');
});
```

With:

```ts
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
```

- [ ] **Step 6: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: add WebSocket transport selection with env var control"
```

---

### Task 5: Manual Testing and Cleanup

- [ ] **Step 1: Test WebRTC mode (default)**

1. Ensure `.env` has no `VITE_TRANSPORT` set (or set to `webrtc`)
2. Run `npm run dev`
3. Open browser, click "開始對話", verify voice works as before

- [ ] **Step 2: Test WebSocket mode**

1. Set `VITE_TRANSPORT=websocket` in `.env`
2. Restart `npm run dev`
3. Open browser, click "開始對話"
4. Verify: mic permission prompt appears, voice input works, AI audio plays back
5. Test mute button toggles correctly
6. Test disconnect cleans up properly (no console errors)

- [ ] **Step 3: Test barge-in**

1. In WebSocket mode, start a conversation
2. While AI is speaking, interrupt by speaking
3. Verify AI audio stops and it starts listening to you

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (articles.test.ts unaffected)

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: cleanup after WebSocket transport testing"
```
