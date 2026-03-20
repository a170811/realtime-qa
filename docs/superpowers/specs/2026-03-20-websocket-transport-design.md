# WebSocket Transport Support

## Overview

Add WebSocket as an alternative transport for the realtime voice assistant, alongside the existing WebRTC transport. Controlled via environment variable, invisible to end users.

## Motivation

WebRTC is the default and works well in most browsers, but some environments (corporate proxies, restricted networks, server-side scenarios) may not support WebRTC. WebSocket provides a fallback path using the same OpenAI Realtime API.

## Configuration

- **Environment variable**: `VITE_TRANSPORT` in `.env`
- **Values**: `webrtc` (default) | `websocket`
- **Frontend access**: `import.meta.env.VITE_TRANSPORT`
- **Token endpoint**: No changes needed — both transports use the same ephemeral token from `/api/token`

Update `.env.example` to document the new variable.

## Architecture

### Approach: Conditional branch in main.ts + dedicated audio module

The `main.ts` file branches on the transport setting. WebSocket-specific audio handling lives in a new `src/ws-audio.ts` module. Everything else (agent definition, tools, UI state, button handlers, speaking state tracking) remains unchanged.

### Files Changed

| File | Change |
|---|---|
| `.env.example` | Add `VITE_TRANSPORT=webrtc` |
| `src/main.ts` | Add transport selection branch, WebSocket-specific mute logic |
| `src/ws-audio.ts` | **New file** — mic capture, audio playback, mute control |

### Files NOT Changed

| File | Reason |
|---|---|
| `vite.config.ts` | Token endpoint works for both transports |
| `src/articles.ts` | No transport dependency |
| `src/utils.ts` | UI helpers are transport-agnostic |
| `index.html` | No UI changes |

## Detailed Design

### main.ts Changes

```ts
const useWebSocket = import.meta.env.VITE_TRANSPORT === 'websocket';
```

**Session creation:**
- WebRTC (default): Same as current code — pass `OpenAIRealtimeWebRTC` instance when `baseUrl` is set, otherwise let SDK auto-select
- WebSocket: Pass `transport: 'websocket'` (or `new OpenAIRealtimeWebSocket({ url })` when `baseUrl` is set)

**Post-connect:**
- WebSocket mode: Call `startAudio(session)` from `ws-audio.ts`

**Mute button:**
- WebRTC: `session.mute(newMutedState)` (unchanged)
- WebSocket: `setMuted(newMutedState)` from `ws-audio.ts`

**Disconnect:**
- WebSocket mode: Call `stopAudio()` before `session.close()`

**Speaking state tracking:** Unchanged — `transport_event` listener for `response.audio.delta` / `response.audio.done` works for both transports.

### ws-audio.ts — WebSocket Audio Module

**Exported interface:**

```ts
export function startAudio(session: RealtimeSession): Promise<void>
export function stopAudio(): void
export function setMuted(muted: boolean): void
```

**Microphone capture (input):**

1. `navigator.mediaDevices.getUserMedia({ audio: true })` to get mic stream
2. Create `AudioContext` with `sampleRate: 24000`
3. Connect mic stream → `AudioWorkletNode` running a PCM16 processor
4. AudioWorklet processor: accumulate samples, post `Int16Array` chunks to main thread
5. Main thread: convert to `ArrayBuffer`, call `session.sendAudio(buffer)`
6. `setMuted(true)`: set a flag to skip `sendAudio` calls (mic stays open)
7. `setMuted(false)`: clear the flag, resume sending

**AudioWorklet processor:**

Created via inline Blob URL (no extra file needed). The processor:
- Receives Float32 samples from the mic
- Converts to Int16 (multiply by 0x7FFF, clamp)
- Posts chunks to the main thread via `port.postMessage`

**Audio playback (output):**

1. Create a separate `AudioContext` for playback (separate from mic context to avoid feedback)
2. Listen to `session.on('audio', callback)` for base64-encoded PCM16 chunks
3. Decode: base64 → `ArrayBuffer` → `Int16Array` → `Float32Array` (divide by 0x7FFF)
4. Create `AudioBuffer` (24kHz, mono), fill with Float32 data
5. Create `AudioBufferSourceNode`, connect to destination, schedule at `nextPlayTime`
6. Track `nextPlayTime` to ensure gapless playback between chunks
7. On `response.audio.done` (via `transport_event`): reset `nextPlayTime`

**Resource cleanup (`stopAudio`):**

- Close both AudioContexts
- Stop all MediaStream tracks
- Remove session event listeners
- Reset all module state

### Error Handling

- **`getUserMedia` failure** (permission denied): Call `showError()` with error message, throw to let `main.ts` catch and reset to disconnected state
- **AudioContext blocked by autoplay policy**: Call `audioContext.resume()` in `startAudio` — safe because it's triggered by user click on "connect" button
- **No retry/reconnect logic**: Matches WebRTC behavior

## Testing Considerations

- `ws-audio.ts` depends on browser APIs (`getUserMedia`, `AudioContext`, `AudioWorklet`) — not unit-testable without mocking
- Manual testing: switch `VITE_TRANSPORT=websocket` in `.env`, verify voice conversation works end-to-end
- Existing `articles.test.ts` unaffected — no transport dependency
