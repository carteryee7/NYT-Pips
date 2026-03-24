/**
 * background.js
 * Service worker. Two jobs:
 *  1. Fetching window.gameData from the page via executeScript (MAIN world)
 *  2. Forwarding all other messages to the content script
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      sendResponse({ ok: false, error: 'No active tab found.' });
      return;
    }

    // ── Fetch gameData with retries ─────────────────────────────────────────
    if (msg.action === 'getGameData') {
      const timeout  = 10000;
      const interval = 300;
      const start    = Date.now();

      while (Date.now() - start < timeout) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world:  'MAIN',
            func:   () => {
              const d = window.gameData;
              // Make sure it's fully populated with the puzzle data
              if (d && d.easy && d.easy.dominoes && d.easy.regions) {
                return d;
              }
              return null;
            },
          });

          const gameData = results?.[0]?.result;
          if (gameData) {
            sendResponse({ ok: true, gameData });
            return;
          }
        } catch (e) {
          console.warn('[PipsSolver] executeScript error:', e.message);
        }

        // Wait before retrying
        await new Promise(r => setTimeout(r, interval));
      }

      sendResponse({ ok: false, error: 'window.gameData did not load in time.' });
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