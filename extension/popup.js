const captureBtn = document.getElementById("captureBtn");
const selBtn     = document.getElementById("selBtn");
const feedback   = document.getElementById("feedback");
const pageInfo   = document.getElementById("pageInfo");
const dot        = document.getElementById("dot");

const SERVER = "http://localhost:33099";

// Check if Electric Sheep desktop app is running
fetch(`${SERVER}/ping`).then(() => dot.className = "dot online").catch(() => dot.className = "dot offline");

// Show current page title
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab) pageInfo.textContent = tab.title || tab.url;
});

function showFeedback(msg, isError = false) {
  feedback.textContent = msg;
  feedback.className   = `feedback ${isError ? "err" : "ok"}`;
}

async function capture(selectionOnly) {
  captureBtn.disabled = true;
  selBtn.disabled     = true;
  feedback.className  = "feedback hidden";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");

    let data;

    if (selectionOnly) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func:   () => window.getSelection()?.toString().trim() || ""
      });
      if (!result) { showFeedback("Nothing selected", true); return; }
      data = { source: new URL(tab.url).hostname, url: tab.url, title: tab.title, text: result };
    } else {
      // Try structured content-script extractor first
      let structured = null;
      try {
        const msg = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE" });
        if (msg?.data?.text) structured = msg.data;
      } catch {}

      if (structured) {
        data = structured;
      } else {
        // Fallback: grab visible text via scripting
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func:   () => ({
            source: location.hostname,
            url:    location.href,
            title:  document.title,
            text:   document.body.innerText.slice(0, 20000).trim()
          })
        });
        data = result;
      }
    }

    if (!data?.text) { showFeedback("Nothing to capture", true); return; }

    const res = await chrome.runtime.sendMessage({ type: "SEND_TO_SHEEP", data });
    if (res.ok) {
      showFeedback(`✓ Saved — "${(data.title || data.url).slice(0, 40)}"`);
    } else {
      showFeedback("Electric Sheep not running.\nStart the desktop app first.", true);
    }
  } catch (e) {
    showFeedback(e.message, true);
  } finally {
    captureBtn.disabled = false;
    selBtn.disabled     = false;
  }
}

captureBtn.addEventListener("click", () => capture(false));
selBtn.addEventListener("click",     () => capture(true));
