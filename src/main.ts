import './style.css';
import { connectButton, disconnectButton, log, muteButton, setButtonStates } from './utils';

import { z } from 'zod';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents-realtime';

// --- Tool definition ---
const getWeather = tool({
  name: 'getWeather',
  description: 'Get the weather for a given city',
  parameters: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    return `The weather in ${city} is sunny`;
  },
});

// --- Agent definitions ---
const weatherAgent = new RealtimeAgent({
  name: 'Weather Agent',
  instructions: 'You are a weather expert.',
  handoffDescription: 'Hand off to me when the user asks about weather.',
  tools: [getWeather],
});

const greeterAgent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'You are a greeter. Always greet the user with "top of the morning".',
  handoffs: [weatherAgent],
});

// Allow weather agent to hand back to greeter
weatherAgent.handoffs.push(greeterAgent);

// --- Session ---
const session = new RealtimeSession(greeterAgent);

session.on('transport_event', (event) => {
  log(event);
});

// --- Button handlers ---
connectButton.addEventListener('click', async () => {
  const apiKey = prompt('Paste your ephemeral API key:');
  if (!apiKey) return;

  try {
    await session.connect({ apiKey });
    setButtonStates('unmuted');
  } catch (err) {
    console.error('Connection failed:', err);
    alert(`Connection failed: ${err instanceof Error ? err.message : err}`);
  }
});

disconnectButton.addEventListener('click', () => {
  session.close();
  setButtonStates('disconnected');
});

muteButton.addEventListener('click', () => {
  const newMutedState = !session.muted;
  session.mute(newMutedState);
  setButtonStates(newMutedState ? 'muted' : 'unmuted');
});
