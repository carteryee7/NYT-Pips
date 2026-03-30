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
          const results = await chrom/**
 * background.js
 * Service worker. Two jobs:
 *  1. Fetching puzzle data directly from the NYT Pips API
 *  2. Forwarding all other messages to the content script
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      sendResponse({ ok: false, error: 'No active tab found.' });
      return;
    }

    // ── Fetch puzzle data from NYT API ──────────────────────────────────────
    if (msg.action === 'getGameData') {
      try {
        // Build today's date string in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        const url   = `https://www.nytimes.com/svc/pips/v1/${today}.json`;

        const resp = await fetch(url, {
          credentials: 'include',  // send NYT login cookies so the request succeeds
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (!resp.ok) {
          sendResponse({ ok: false, error: `API returned ${resp.status}` });
          return;
        }

        const gameData = await resp.json();

        // Validate the response has what we need
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
});e.scripting.executeScript({
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