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

export async function startAudio(session: RealtimeSession): Promise<void> {
  stopAudio();
  currentSession = session;
  muted = false;

  try {
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
  } catch (err) {
    stopAudio();
    throw err;
  }
}

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
