/**
 * popup.js
 * Handles all UI interactions in the extension popup.
 */

// ─── State ────────────────────────────────────────────────────────────────────

let difficulty     = 'easy';
let hintsRemaining = 3;
let solved         = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const solveBtn = document.getElementById('solveBtn');
const hintBtn  = document.getElementById('hintBtn');
const clearBtn = document.getElementById('clearBtn');
const status   = document.getElementById('status');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(msg, type = '') {
  status.textContent  = msg;
  status.className    = type;
}

function setLoading(loading) {
  solveBtn.disabled = loading;
  solveBtn.textContent = loading ? 'Solving…' : 'Solve Puzzle';
}

function updateHintPips(remaining) {
  for (let i = 0; i < 3; i++) {
    document.getElementById(`pip${i}`).classList.toggle('used', i >= remaining);
  }
  hintBtn.disabled    = remaining === 0 || !solved;
  hintBtn.textContent = remaining > 0 ? `💡 Hint (${remaining} left)` : '💡 No hints left';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// All messages go through background.js which forwards to content.js
function sendToContent(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

// ─── Difficulty buttons ───────────────────────────────────────────────────────

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    difficulty = btn.dataset.diff;

    // Reset state when difficulty changes
    solved = false;
    updateHintPips(3);
    setStatus(`Difficulty set to ${difficulty}.`);
  });
});

// ─── Solve ────────────────────────────────────────────────────────────────────

solveBtn.addEventListener('click', async () => {
  setLoading(true);
  setStatus('Solving…');

  try {
    const resp = await sendToContent({ action: 'solve', difficulty });

    if (resp?.ok) {
      solved         = true;
      hintsRemaining = resp.hintsRemaining ?? 3;
      updateHintPips(hintsRemaining);

      // Overlay full solution
      await sendToContent({ action: 'overlay' });
      setStatus('✅ Solved!', 'ok');
    } else {
      setStatus(`❌ ${resp?.error ?? 'Could not solve.'}`, 'error');
    }
  } catch (e) {
    setStatus('❌ Error — is the Pips page open?', 'error');
  } finally {
    setLoading(false);
  }
});

// ─── Hint ─────────────────────────────────────────────────────────────────────

hintBtn.addEventListener('click', async () => {
  hintBtn.disabled = true;
  setStatus('Finding best hint…');

  try {
    const resp = await sendToContent({ action: 'hint' });

    if (resp?.ok) {
      hintsRemaining = resp.hintsRemaining;
      updateHintPips(hintsRemaining);

      if (resp.hadError) {
        const msg = resp.classification === 'wrong'
          ? '⚠️ Corrected a mistake and revealed the domino.'
          : '⚠️ Filled in a partial placement.';
        setStatus(msg, 'warn');
      } else {
        setStatus(`💡 Hint revealed! ${hintsRemaining} hint${hintsRemaining !== 1 ? 's' : ''} remaining.`, 'ok');
      }
    } else {
      setStatus(`ℹ️ ${resp?.error ?? 'No hint available.'}`, 'warn');
      hintBtn.disabled = hintsRemaining === 0;
    }
  } catch (e) {
    setStatus('❌ Error sending hint.', 'error');
    hintBtn.disabled = false;
  }
});

// ─── Clear ────────────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', async () => {
  try {
    await sendToContent({ action: 'clear' });
    solved = false;
    updateHintPips(3);
    setStatus('Cleared.', '');
  } catch (e) {
    setStatus('❌ Error clearing overlays.', 'error');
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

updateHintPips(3);