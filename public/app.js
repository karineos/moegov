const chatMessages = document.getElementById("chatMessages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const healthBadge = document.getElementById("healthBadge");
const promptButtons = document.querySelectorAll(".prompt-chip");

let isSending = false;

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isArabic(text) {
  return /[\u0600-\u06FF]/.test(text);
}

function autoResizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createMessageRow(role, html, opts = {}) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const isUser = role === "user";
  const avatar = document.createElement("div");
  avatar.className = `avatar ${isUser ? "user-avatar" : "assistant-avatar"}`;
  avatar.textContent = isUser ? "You" : "AI";

  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${isUser ? "user-bubble" : "assistant-bubble"}`;

  const content = document.createElement("div");
  content.className = "message-content";

  if (opts.rtl) {
    content.classList.add("is-rtl");
  }

  content.innerHTML = html;
  bubble.appendChild(content);

  if (opts.meta) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = opts.meta;
    bubble.appendChild(meta);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);

  return row;
}

function renderTypingIndicator() {
  return `
    <div class="typing">
      <span></span><span></span><span></span>
    </div>
  `;
}

function parseMarkdownTable(lines) {
  if (lines.length < 2) return null;

  const header = lines[0];
  const divider = lines[1];

  if (!header.includes("|")) return null;
  if (!/^[:\-\|\s]+$/.test(divider.trim())) return null;

  const parseRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const headers = parseRow(header);
  const bodyLines = lines.slice(2).filter((line) => line.trim() && line.includes("|"));
  const rows = bodyLines.map(parseRow);

  if (!headers.length || !rows.length) return null;

  return { headers, rows };
}

function buildTableHtml(table, rtl = false) {
  const headerHtml = table.headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");

  const rowsHtml = table.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
    )
    .join("");

  return `
    <div class="rendered-table-wrap ${rtl ? "is-rtl" : ""}">
      <div class="rendered-table-scroll">
        <table class="rendered-table">
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function formatInline(text) {
  let html = escapeHtml(text);

  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  return html;
}

function formatStructuredText(rawText) {
  const text = String(rawText || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "<p>No answer returned.</p>";

  const rtl = isArabic(text);
  const blocks = [];
  const lines = text.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (line.trim().startsWith("```")) {
      let codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      i++;
      continue;
    }

    // markdown table
    if (
      i + 1 < lines.length &&
      lines[i].includes("|") &&
      /^[:\-\|\s]+$/.test(lines[i + 1].trim())
    ) {
      const tableLines = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = parseMarkdownTable(tableLines);
      if (parsed) {
        blocks.push(buildTableHtml(parsed, rtl));
        continue;
      }
    }

    // bullet list
    if (/^[-*]\s+/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        `<ul>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`
      );
      continue;
    }

    // numbered list
    if (/^\d+\.\s+/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        `<ol>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ol>`
      );
      continue;
    }

    // plain paragraphs
    if (line.trim() === "") {
      i++;
      continue;
    }

    let paragraphLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].includes("|") &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("```")
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }

    blocks.push(`<p>${formatInline(paragraphLines.join(" "))}</p>`);
  }

  return `<div class="${rtl ? "is-rtl" : ""}">${blocks.join("")}</div>`;
}

function addUserMessage(text) {
  const html = `<p>${escapeHtml(text)}</p>`;
  const row = createMessageRow("user", html, { rtl: isArabic(text) });
  chatMessages.appendChild(row);
  scrollToBottom();
}

function addAssistantMessage(rawText, meta = "") {
  const html = formatStructuredText(rawText);
  const row = createMessageRow("assistant", html, {
    rtl: isArabic(rawText),
    meta
  });
  chatMessages.appendChild(row);
  scrollToBottom();
}

function addTypingMessage() {
  const row = createMessageRow("assistant", renderTypingIndicator());
  row.id = "typingRow";
  chatMessages.appendChild(row);
  scrollToBottom();
}

function removeTypingMessage() {
  const typingRow = document.getElementById("typingRow");
  if (typingRow) typingRow.remove();
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();

    if (data.ok && data.configured) {
      healthBadge.textContent = "Connected";
      healthBadge.className = "status-badge connected";
    } else {
      healthBadge.textContent = "Not configured";
      healthBadge.className = "status-badge error";
    }
  } catch (err) {
    healthBadge.textContent = "Offline";
    healthBadge.className = "status-badge error";
  }
}

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || isSending) return;

  isSending = true;
  sendBtn.disabled = true;

  addUserMessage(message);
  messageInput.value = "";
  autoResizeTextarea();
  addTypingMessage();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const data = await res.json();
    removeTypingMessage();

    if (!res.ok) {
      addAssistantMessage(
        data?.details || data?.error || "Something went wrong while fetching the answer.",
        "Error"
      );
      return;
    }

    addAssistantMessage(
      data.answer || "No answer returned.",
      data.provider ? `Source: ${data.provider}` : ""
    );
  } catch (error) {
    removeTypingMessage();
    addAssistantMessage(
      "There was a connection problem while contacting the assistant. Please try again.",
      "Connection error"
    );
  } finally {
    isSending = false;
    sendBtn.disabled = false;
  }
}

clearBtn.addEventListener("click", () => {
  chatMessages.innerHTML = `
    <div class="message-row assistant">
      <div class="avatar assistant-avatar">AI</div>
      <div class="message-bubble assistant-bubble">
        <div class="message-content">
          <p>Hello, I’m ready.</p>
          <p>Ask about totals, percentages, student counts, regional rankings, school indicators, or comparisons across the available MOE datasets.</p>
        </div>
      </div>
    </div>
  `;
});

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

messageInput.addEventListener("input", autoResizeTextarea);

promptButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    messageInput.value = btn.textContent.trim();
    autoResizeTextarea();
    messageInput.focus();
  });
});

checkHealth();
autoResizeTextarea();