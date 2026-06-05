// Structured extractors for known AI sites
const EXTRACTORS = {
  "claude.ai": {
    turns: '[data-testid="human-turn"], [data-testid="ai-turn"]',
    role:  el => el.dataset.testid === "human-turn" ? "human" : "assistant",
    text:  el => el.innerText.trim()
  },
  "chat.openai.com": {
    turns: "[data-message-author-role]",
    role:  el => el.dataset.messageAuthorRole,
    text:  el => (el.querySelector(".markdown") || el).innerText.trim()
  },
  "chatgpt.com": {
    turns: "[data-message-author-role]",
    role:  el => el.dataset.messageAuthorRole,
    text:  el => (el.querySelector(".markdown") || el).innerText.trim()
  },
  "gemini.google.com": {
    turns: "user-chunk, model-response",
    role:  el => el.tagName.toLowerCase() === "user-chunk" ? "human" : "assistant",
    text:  el => el.innerText.trim()
  },
  "copilot.microsoft.com": {
    turns: "[data-testid='user-message'], [data-testid='response-message-content']",
    role:  el => el.dataset.testid === "user-message" ? "human" : "assistant",
    text:  el => el.innerText.trim()
  },
  "www.perplexity.ai": {
    turns: ".user-query, .prose",
    role:  el => el.classList.contains("user-query") ? "human" : "assistant",
    text:  el => el.innerText.trim()
  }
};

function getExtractor() {
  const host = location.hostname;
  const key  = Object.keys(EXTRACTORS).find(k => host.includes(k));
  return key ? EXTRACTORS[key] : null;
}

function captureConversation() {
  const ext = getExtractor();

  if (ext) {
    const els      = [...document.querySelectorAll(ext.turns)];
    const messages = els
      .map(el => ({ role: ext.role(el), text: ext.text(el) }))
      .filter(m => m.text.length > 0);

    const text = messages.map(m => `[${m.role}]\n${m.text}`).join("\n\n---\n\n");
    return {
      source:       location.hostname,
      url:          location.href,
      title:        document.title,
      text,
      messageCount: messages.length
    };
  }

  // Generic fallback — return selected text or visible body text
  const selection = window.getSelection()?.toString().trim();
  return {
    source: location.hostname,
    url:    location.href,
    title:  document.title,
    text:   selection || document.body.innerText.slice(0, 20000).trim()
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "CAPTURE") {
    reply({ data: captureConversation() });
  }
  return true;
});
