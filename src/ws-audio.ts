import type { RealtimeSession } from '@openai/agents-realtime';

// --- Module state ---
let micContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;
let playbackContext: AudioContext | null = null;
let currentSession: RealtimeSession | null = null;
let muted = false;

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
}
