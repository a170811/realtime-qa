export const connectButton = document.querySelector<HTMLButtonElement>('#connectButton')!;
export const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnectButton')!;
export const muteButton = document.querySelector<HTMLButtonElement>('#muteButton')!;

const apiKeySection = document.querySelector<HTMLDivElement>('#apiKeySection')!;
export const apiKeyInput = document.querySelector<HTMLInputElement>('#apiKeyInput')!;
const apiKeyError = document.querySelector<HTMLParagraphElement>('#apiKeyError')!;

const waveform = document.querySelector<HTMLDivElement>('#waveform')!;
const waveformBars = waveform.querySelectorAll<HTMLSpanElement>('.waveform-bar');
const statusText = document.querySelector<HTMLParagraphElement>('#statusText')!;

const micIcon = document.querySelector<SVGElement>('#micIcon')!;
const micOffIcon = document.querySelector<SVGElement>('#micOffIcon')!;

const citationsSection = document.querySelector<HTMLDivElement>('#citationsSection')!;
const citationsList = document.querySelector<HTMLUListElement>('#citationsList')!;

export type UIState = 'disconnected' | 'connecting' | 'unmuted' | 'muted';

export function setUIState(state: UIState) {
  // API key section
  apiKeySection.classList.toggle('hidden', state !== 'disconnected');

  // Waveform
  const showWaveform = state === 'unmuted' || state === 'muted';
  waveform.classList.toggle('hidden', !showWaveform);
  waveform.classList.toggle('flex', showWaveform);

  // Waveform bar states
  waveformBars.forEach((bar) => {
    bar.classList.remove('listening', 'speaking', 'muted');
    if (state === 'unmuted') bar.classList.add('listening');
    else if (state === 'muted') bar.classList.add('muted');
  });

  // Status text
  const statusMap: Record<UIState, string> = {
    disconnected: '',
    connecting: '連線中...',
    unmuted: '聆聽中...',
    muted: '已靜音',
  };
  statusText.textContent = statusMap[state];

  // Buttons
  connectButton.classList.toggle('hidden', state !== 'disconnected');
  connectButton.disabled = state === 'connecting';
  connectButton.textContent = state === 'connecting' ? '連線中...' : '開始對話';

  disconnectButton.classList.toggle('hidden', state === 'disconnected' || state === 'connecting');

  const showMute = state === 'unmuted' || state === 'muted';
  muteButton.classList.toggle('hidden', !showMute);
  muteButton.classList.toggle('flex', showMute);

  // Mute icon toggle
  const isMuted = state === 'muted';
  micIcon.classList.toggle('hidden', isMuted);
  micOffIcon.classList.toggle('hidden', !isMuted);
  muteButton.setAttribute('aria-label', isMuted ? '取消靜音' : '靜音');
  muteButton.classList.toggle('border-red-300', isMuted);
  muteButton.classList.toggle('text-red-500', isMuted);
  muteButton.classList.toggle('border-slate-200', !isMuted);
  muteButton.classList.toggle('text-slate-500', !isMuted);
}

export function setSpeaking(isSpeaking: boolean) {
  waveformBars.forEach((bar) => {
    bar.classList.remove('listening', 'speaking');
    bar.classList.add(isSpeaking ? 'speaking' : 'listening');
  });
  statusText.textContent = isSpeaking ? '回答中...' : '聆聽中...';
}

export function showApiKeyError(message: string) {
  apiKeyError.textContent = message;
  apiKeyError.classList.remove('hidden');
}

export function hideApiKeyError() {
  apiKeyError.classList.add('hidden');
}

export function showCitations(articles: { title: string }[]) {
  if (articles.length === 0) return;
  while (citationsList.firstChild) {
    citationsList.removeChild(citationsList.firstChild);
  }
  articles.forEach(({ title }) => {
    const li = document.createElement('li');
    li.className = 'text-sm text-slate-500 pl-3 border-l-2 border-slate-200';
    li.textContent = title;
    citationsList.appendChild(li);
  });
  citationsSection.classList.remove('hidden');
}
