import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { DefaultAzureCredential } from '@azure/identity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const APP_TITLE = process.env.APP_TITLE || 'MOE Research Data Assistant';
const FOUNDRY_PROJECT_ENDPOINT = normalizeEndpoint(process.env.FOUNDRY_PROJECT_ENDPOINT);
const FOUNDRY_AGENT_NAME = process.env.FOUNDRY_AGENT_NAME;
const FOUNDRY_AGENT_VERSION = process.env.FOUNDRY_AGENT_VERSION;

const credential = new DefaultAzureCredential();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 30;
  const entry = hits.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  hits.set(key, entry);
  if (entry.count > limit) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }
  next();
}

function normalizeEndpoint(endpoint) {
  return endpoint?.replace(/\/+$/, '');
}

function configured() {
  return Boolean(FOUNDRY_PROJECT_ENDPOINT && FOUNDRY_AGENT_NAME);
}

async function getFoundryToken() {
  const token = await credential.getToken('https://ai.azure.com/.default');
  if (!token?.token) throw new Error('Could not get Microsoft Entra token for Foundry. Check App Service Managed Identity and RBAC permissions.');
  return token.token;
}

function buildAgentReference() {
  const agentReference = {
    name: FOUNDRY_AGENT_NAME,
    type: 'agent_reference'
  };
  if (FOUNDRY_AGENT_VERSION) {
    agentReference.version = FOUNDRY_AGENT_VERSION;
  }
  return agentReference;
}

function extractText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;

  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text);
      if (typeof content?.value === 'string') parts.push(content.value);
    }
  }

  if (parts.length) return parts.join('\n\n');
  return JSON.stringify(data, null, 2);
}

function extractCitations(data) {
  const citations = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      for (const ann of content?.annotations || []) {
        const title = ann.title || ann.filepath || ann.url || ann.text || 'Citation';
        citations.push({
          number: citations.length + 1,
          title,
          url: ann.url || '',
          filepath: ann.filepath || '',
          content: ann.text || ann.quote || ''
        });
      }
    }
  }
  return citations.slice(0, 10);
}

app.get('/api/config', (_req, res) => {
  res.json({
    appTitle: APP_TITLE,
    configured: configured(),
    searchIndex: FOUNDRY_AGENT_NAME || null,
    queryType: 'Foundry Agent'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: configured(), appTitle: APP_TITLE });
});

app.post('/api/chat', rateLimit, async (req, res) => {
  try {
    if (!configured()) {
      return res.status(500).json({
        error: 'The app is not configured yet. Add FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_AGENT_NAME in App Service > Configuration.'
      });
    }

    const userMessage = String(req.body?.message || '').trim();
    if (!userMessage) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const conversationId = req.body?.conversationId || null;
    const token = await getFoundryToken();

    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const convRes = await fetch(`${FOUNDRY_PROJECT_ENDPOINT}/openai/v1/conversations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const convRaw = await convRes.text();
      const convData = JSON.parse(convRaw || '{}');
      if (!convRes.ok) {
        return res.status(convRes.status).json({ error: convData?.error?.message || 'Failed to create Foundry conversation.', details: convData });
      }
      activeConversationId = convData.id;
    }

    const responseRes = await fetch(`${FOUNDRY_PROJECT_ENDPOINT}/openai/v1/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: userMessage,
        conversation: activeConversationId,
        agent_reference: buildAgentReference()
      })
    });

    const raw = await responseRes.text();
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      data = { raw };
    }

    if (!responseRes.ok) {
      console.error('Foundry response error:', JSON.stringify(data, null, 2));
      return res.status(responseRes.status).json({
        error: data?.error?.message || 'Foundry agent request failed.',
        details: data?.error || data
      });
    }

    res.json({
      answer: extractText(data),
      citations: extractCitations(data),
      conversationId: activeConversationId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`${APP_TITLE} running on port ${PORT}`);
});
