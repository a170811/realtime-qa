import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  const result: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadPreferredEnv(mode: string, envDir: string): Record<string, string | undefined> {
  const envFiles = [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ];

  const fileEnv = envFiles.reduce<Record<string, string>>((acc, fileName) => {
    const filePath = path.resolve(envDir, fileName);
    return { ...acc, ...parseEnvFile(filePath) };
  }, {});

  return {
    ...process.env,
    ...fileEnv,
  };
}

function tokenEndpoint(): Plugin {
  let apiKey: string;
  let baseUrl: string;
  let rawBaseUrl: string;

  return {
    name: 'token-endpoint',
    configResolved({ envDir, mode }) {
      const env = loadPreferredEnv(mode, envDir);
      apiKey = env.OPENAI_API_KEY;
      rawBaseUrl = env.BASE_URL || '';
      baseUrl = (rawBaseUrl || 'https://api.openai.com').replace(/\/+$/, '');
    },
    configureServer(server) {
      server.middlewares.use('/api/token', async (_req, res) => {
        if (!apiKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing OPENAI_API_KEY in .env' }));
          return;
        }

        try {
          const response = await fetch(
            `${baseUrl}/v1/realtime/client_secrets`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                session: { type: 'realtime', model: 'gpt-realtime' },
              }),
            },
          );

          const data = await response.json();
          if (!response.ok) {
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: data.error?.message ?? 'Unknown error' }));
            return;
          }

          const token = data.value ?? data.client_secret?.value;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            token,
            baseUrl: rawBaseUrl || undefined,
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : 'Failed to generate token',
          }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), tokenEndpoint()],
});
