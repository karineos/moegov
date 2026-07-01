const messagesEl = document.getElementById('messages');
const form = document.getElementById('chatForm');
const input = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const sourcesEl = document.getElementById('sources');
const clearChat = document.getElementById('clearChat');
const configStatus = document.getElementById('configStatus');
const indexName = document.getElementById('indexName');

let history = JSON.parse(localStorage.getItem('moe-chat-history') || '[]');
let conversationId = localStorage.getItem('moe-conversation-id') || null;

function saveHistory() {
  localStorage.setItem('moe-chat-history', JSON.stringify(history.slice(-12)));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function inlineMarkdown(value) {
  return value
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => inlineMarkdown(cell.trim()));
}

function renderMarkdownLite(text) {
  const escaped = escapeHtml(text || '');
  const lines = escaped.split('\n');
  const output = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      i += 2;

      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      i--;

      output.push(`
        <div class="table-wrap">
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `);

      continue;
    }

    if (line.trim() === '') {
      output.push('<br>');
    } else {
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  return output.join('');
}

function addMessage(role, content) {
  const row = document.createElement('div');
  row.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'You' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdownLite(content);

  if (role === 'user') {
    row.appendChild(bubble);
    row.appendChild(avatar);
  } else {
    row.appendChild(avatar);
    row.appendChild(bubble);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function renderSources(citations = []) {
  if (!citations.length) {
    sourcesEl.classList.add('hidden');
    sourcesEl.innerHTML = '';
    return;
  }

  sourcesEl.classList.remove('hidden');
  sourcesEl.innerHTML = '<h3>Retrieved sources</h3>' + citations.map((c) => `
    <div class="source-item">
      <strong>${c.number}. ${escapeHtml(c.title || 'Source')}</strong>
      ${c.filepath ? `<p>File: ${escapeHtml(c.filepath)}</p>` : ''}
      ${c.url ? `<p>URL: ${escapeHtml(c.url)}</p>` : ''}
      ${c.content ? `<p>${escapeHtml(c.content)}</p>` : ''}
    </div>
  `).join('');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    configStatus.className = data.configured ? 'status good' : 'status bad';
    configStatus.textContent = data.configured ? 'Connected' : 'Missing settings';
    indexName.textContent = data.searchIndex ? `Index: ${data.searchIndex} · Query: ${data.queryType}` : 'Configure App Service settings first.';
  } catch {
    configStatus.className = 'status bad';
    configStatus.textContent = 'Server unavailable';
  }
}

async function sendMessage(message) {
  addMessage('user', message);
  const thinking = addMessage('assistant', 'Searching MOE data...');
  sendButton.disabled = true;
  input.disabled = true;
  renderSources([]);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, conversationId })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed.');
    }

    thinking.innerHTML = renderMarkdownLite(data.answer || 'No answer returned.');
    if (data.conversationId) {
      conversationId = data.conversationId;
      localStorage.setItem('moe-conversation-id', conversationId);
    }
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: data.answer || '' });
    saveHistory();
    renderSources(data.citations || []);
  } catch (err) {
    thinking.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message)}`;
  } finally {
    sendButton.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  sendMessage(message);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.dispatchEvent(new Event('submit'));
  }
});

document.querySelectorAll('[data-prompt]').forEach((btn) => {
  btn.addEventListener('click', () => {
    input.value = btn.dataset.prompt;
    input.focus();
  });
});

clearChat.addEventListener('click', () => {
  history = [];
  conversationId = null;
  localStorage.removeItem('moe-conversation-id');
  saveHistory();
  messagesEl.innerHTML = '';
  addMessage('assistant', 'Chat cleared. Ask me a new MOE research question.');
  renderSources([]);
});

loadConfig();
