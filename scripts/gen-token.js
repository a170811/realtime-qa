import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env'), 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => l.split('='))
);

const apiKey = env['OPENAI_API_KEY'];
if (!apiKey) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    session: {
      type: 'realtime',
      model: 'gpt-realtime',
    },
  }),
});

const data = await res.json();
if (!res.ok) {
  console.error('Error:', data.error?.message);
  process.exit(1);
}

console.log('\nEphemeral key:');
console.log(data.value ?? data.client_secret?.value);
