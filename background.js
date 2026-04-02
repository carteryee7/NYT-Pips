/**
 * background.js
 * Service worker. Two jobs:
 *  1. Fetch puzzle data directly from the NYT Pips API
 *  2. Forward all non-data actions to the content script
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      sendResponse({ ok: false, error: 'No active tab found.' });
      return;
    }

    // ── Fetch puzzle data from NYT API ──────────────────────────────────────
    if (msg.action === 'getGameData') {
      try {
        const localDate = new Date();
        const today = [
          localDate.getFullYear(),
          String(localDate.getMonth() + 1).padStart(2, '0'),
          String(localDate.getDate()).padStart(2, '0'),
        ].join('-');
        const url = `https://www.nytimes.com/svc/pips/v1/${today}.json`;

        const resp = await fetch(url, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!resp.ok) {
          sendResponse({ ok: false, error: `API returned ${resp.status}` });
          return;
        }

        const gameData = await resp.json();

        if (!gameData?.easy?.dominoes || !gameData?.easy?.regions) {
          sendResponse({ ok: false, error: 'Unexpected API response shape.' });
          return;
        }

        sendResponse({ ok: true, gameData });
      } catch (e) {
        sendResponse({ ok: false, error: `Fetch failed: ${e.message}` });
      }
      return;
    }

    // ── Forward all other actions to content script ─────────────────────────
    try {
      const response = await chrome.tabs.sendMessage(tab.id, msg);
      sendResponse(response);
    } catch (e) {
      sendResponse({ ok: false, error: `Content script error: ${e.message}` });
    }
  })();

  return true;
});