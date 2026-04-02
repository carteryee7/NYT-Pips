/**
 * content.js
 * Runs in the ISOLATED world.
 * Requests gameData from background.js which fetches it from the MAIN world.
 */

// ─── State ────────────────────────────────────────────────────────────────────

let _solution   = null;
let _hintMgr    = null;
let _overlayEls = [];

// ─── Game Data Access ─────────────────────────────────────────────────────────

/**
 * Ask the background service worker to fetch window.gameData
 * from the page's MAIN world via executeScript.
 * Retries until data is available or timeout is reached.
 */
function waitForGameData() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timeoutMs = 15000;
    const retryDelayMs = 350;

    const attempt = () => {
      chrome.runtime.sendMessage({ action: 'getGameData' }, (resp) => {
        if (resp?.ok && resp.gameData) {
          resolve(resp.gameData);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(resp?.error ?? 'window.gameData did not load in time.'));
          return;
        }

        setTimeout(attempt, retryDelayMs);
      });
    };

    attempt();
  });
}

// ─── Puzzle Parser ────────────────────────────────────────────────────────────

function normalizePuzzleData(gameData, difficulty) {
  const d = gameData[difficulty];
  if (!d) throw new Error(`No data found for difficulty: ${difficulty}`);
  return {
    [difficulty]: {
      regions:  d.regions,
      dominoes: d.dominoes,
      solution: d.solution,
    }
  };
}

/**
 * Cross-reference solution placements with domino values.
 * gameData.solution[i] = [[r1,c1],[r2,c2]]
 * gameData.dominoes[i] = [valA, valB]
 */
function extractSolutionFromGameData(gameData, difficulty) {
  const d = gameData[difficulty];
  if (!d?.solution || !d?.dominoes) return null;

  const sol = {};
  d.solution.forEach((placement, i) => {
    const domino = d.dominoes[i];
    if (!domino || !placement || placement.length < 2) return;
    const [[r1, c1], [r2, c2]] = placement;
    sol[`${r1},${c1}`] = domino[0];
    sol[`${r2},${c2}`] = domino[1];
  });

  return Object.keys(sol).length ? sol : null;
}

// ─── Cell Map ─────────────────────────────────────────────────────────────────

function buildCellMap(gameData, difficulty) {
  const cells   = Array.from(document.querySelectorAll('[class*="droppableCell"]'));
  const cellMap = new Map();

  if (!cells.length) {
    console.warn('[PipsSolver] No cells found — class name may have changed.');
    return cellMap;
  }

  const d          = gameData[difficulty];
  const allCoords  = [];
  for (const region of d.regions) {
    for (const idx of region.indices) {
      allCoords.push(idx);
    }
  }

  const keySet = new Set(allCoords.map(([r, c]) => `${r},${c}`));

  // Try mapping by explicit row/col attributes first.
  for (const cell of cells) {
    const rowRaw = cell.dataset.row ?? cell.getAttribute('data-row');
    const colRaw = cell.dataset.col ?? cell.getAttribute('data-col');
    if (rowRaw == null || colRaw == null) continue;
    const r = Number(rowRaw);
    const c = Number(colRaw);
    if (Number.isInteger(r) && Number.isInteger(c)) {
      const key = `${r},${c}`;
      if (keySet.has(key)) cellMap.set(key, cell);
    }
  }

  if (cellMap.size === keySet.size) return cellMap;

  // Fallback: infer grid coordinates from on-screen geometry.
  const positioned = cells
    .map(cell => {
      const rect = cell.getBoundingClientRect();
      return {
        cell,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  const clusterAxis = (values, tolerance = 6) => {
    const sorted = [...values].sort((a, b) => a - b);
    const buckets = [];
    for (const v of sorted) {
      const last = buckets[buckets.length - 1];
      if (!last || Math.abs(v - last.center) > tolerance) {
        buckets.push({ center: v, count: 1 });
      } else {
        last.center = (last.center * last.count + v) / (last.count + 1);
        last.count += 1;
      }
    }
    return buckets.map(b => b.center);
  };

  const rows = clusterAxis(positioned.map(p => p.y));
  const cols = clusterAxis(positioned.map(p => p.x));

  if (rows.length && cols.length) {
    const nearestIdx = (arr, value) => {
      let best = 0;
      let bestDist = Math.abs(arr[0] - value);
      for (let i = 1; i < arr.length; i++) {
        const d = Math.abs(arr[i] - value);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    };

    const grid = new Map();
    for (const p of positioned) {
      const r = nearestIdx(rows, p.y);
      const c = nearestIdx(cols, p.x);
      const key = `${r},${c}`;
      if (!grid.has(key)) grid.set(key, p.cell);
    }

    for (const [r, c] of allCoords) {
      const key = `${r},${c}`;
      const cell = grid.get(key);
      if (cell) cellMap.set(key, cell);
    }
  }

  if (cellMap.size === keySet.size) return cellMap;

  // Sort row-major (top-left → bottom-right) to match DOM order
  allCoords.sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);

  const fallbackMap = new Map();
  allCoords.forEach((coord, i) => {
    if (cells[i]) fallbackMap.set(`${coord[0]},${coord[1]}`, cells[i]);
  });

  // Keep any successfully inferred mappings, fill missing keys from fallback.
  for (const [key, cell] of fallbackMap.entries()) {
    if (!cellMap.has(key)) cellMap.set(key, cell);
  }

  return cellMap;
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

function clearOverlays() {
  _overlayEls.forEach(el => el.remove());
  _overlayEls = [];
}

function renderOverlay(cellMap, solutionMap, color = '#e63946', onlyKeys = null) {
  for (const [key, value] of Object.entries(solutionMap)) {
    if (onlyKeys && !onlyKeys.has(key)) continue;

    const cell = cellMap.get(key);
    if (!cell) continue;
    if (cell.querySelector('.pips-solver-overlay')) continue;

    const div         = document.createElement('div');
    div.className     = 'pips-solver-overlay';
    div.textContent   = value;
    div.style.cssText = `
      position:       absolute;
      top:            50%;
      left:           50%;
      transform:      translate(-50%, -50%);
      font-size:      22px;
      font-weight:    700;
      color:          ${color};
      pointer-events: none;
      z-index:        9999;
      animation:      pipsFadeIn 0.25s ease;
    `;
    cell.style.position = 'relative';
    cell.appendChild(div);
    _overlayEls.push(div);
  }
}

const _style         = document.createElement('style');
_style.textContent   = `
  @keyframes pipsFadeIn {
    from { opacity: 0; transform: translate(-50%, -60%); }
    to   { opacity: 1; transform: translate(-50%, -50%); }
  }
`;
document.head.appendChild(_style);

// ─── Board State ──────────────────────────────────────────────────────────────

function getCurrentBoardState(cellMap) {
  const state = {};
  for (const [key, cell] of cellMap.entries()) {
    const val = cell.dataset.placedValue
            ?? cell.querySelector('[data-value]')?.dataset.value
            ?? cell.querySelector('.pip-value')?.textContent?.trim();
    if (val !== undefined && val !== null && val !== '') {
      state[key] = parseInt(val);
    }
  }
  return state;
}

// ─── Hint Manager ─────────────────────────────────────────────────────────────

class HintManager {
  constructor(solution, gameData, difficulty) {
    this.solution    = solution;
    this.revealed    = new Set();
    this.hintsUsed   = 0;
    this.maxHints    = 3;
    this.pairs       = this._buildPairs(gameData, difficulty);
    this.rankedKeys  = this._rankCells(gameData, difficulty);
  }

  hintsRemaining() { return this.maxHints - this.hintsUsed; }

  getNextHint(boardState) {
    if (this.hintsUsed >= this.maxHints) return null;

    for (const key of this.rankedKeys) {
      if (this.revealed.has(key)) continue;
      const partnerKey = this.pairs.get(key);
      if (!partnerKey) continue;

      const classification = this._classify(key, partnerKey, boardState);
      if (classification === 'complete') continue;

      this.revealed.add(key);
      this.revealed.add(partnerKey);
      this.hintsUsed++;

      return {
        cells: [
          { key, value: this.solution[key] },
          { key: partnerKey, value: this.solution[partnerKey] },
        ],
        classification,
        hadError: classification === 'wrong' || classification === 'partial',
      };
    }
    return null;
  }

  _buildPairs(gameData, difficulty) {
    const pairs = new Map();
    for (const placement of gameData[difficulty].solution) {
      if (placement.length < 2) continue;
      const keyA = `${placement[0][0]},${placement[0][1]}`;
      const keyB = `${placement[1][0]},${placement[1][1]}`;
      pairs.set(keyA, keyB);
      pairs.set(keyB, keyA);
    }
    return pairs;
  }

  _classify(key, partnerKey, boardState) {
    const uA = boardState[key];
    const uB = boardState[partnerKey];
    const sA = this.solution[key];
    const sB = this.solution[partnerKey];
    if (uA === sA && uB === sB)              return 'complete';
    if (uA === undefined && uB === undefined) return 'empty';
    if (uA === sA || uB === sB)              return 'partial';
    return 'wrong';
  }

  _rankCells(gameData, difficulty) {
    const scores = {};
    for (const key of Object.keys(this.solution)) scores[key] = 0;
    for (const region of gameData[difficulty].regions) {
      const w = { sum: 10, equals: 8, unequal: 7, greater: 6, less: 6 }[region.type] ?? 0;
      for (const idx of region.indices) {
        const key = `${idx[0]},${idx[1]}`;
        if (key in scores) scores[key] += w;
      }
    }
    return Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
  }
}

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const difficulty = msg.difficulty ?? 'easy';

      switch (msg.action) {

        case 'solve': {
          const gameData = await waitForGameData();
          const sol      = extractSolutionFromGameData(gameData, difficulty);

          if (!sol) {
            const puzzle = normalizePuzzleData(gameData, difficulty);
            const solver = new PipsSolver(puzzle, difficulty);
            if (solver.solve() !== true) {
              sendResponse({ ok: false, error: 'Solver failed.' }); return;
            }
            _solution = solver.getSolution();
          } else {
            _solution = sol;
          }

          _hintMgr = new HintManager(_solution, gameData, difficulty);
          sendResponse({ ok: true, hintsRemaining: _hintMgr.hintsRemaining() });
          break;
        }

        case 'overlay': {
          if (!_solution) { sendResponse({ ok: false, error: 'No solution.' }); return; }
          const gameData = await waitForGameData();
          const cellMap  = buildCellMap(gameData, difficulty);
          clearOverlays();
          renderOverlay(cellMap, _solution, '#e63946');
          sendResponse({ ok: true });
          break;
        }

        case 'hint': {
          if (!_hintMgr)                       { sendResponse({ ok: false, error: 'Solve first.' }); return; }
          if (_hintMgr.hintsRemaining() === 0) { sendResponse({ ok: false, error: 'No hints remaining.' }); return; }

          const gameData   = await waitForGameData();
          const cellMap    = buildCellMap(gameData, difficulty);
          const boardState = getCurrentBoardState(cellMap);
          const hint       = _hintMgr.getNextHint(boardState);

          if (!hint) { sendResponse({ ok: false, error: 'All cells already correct!' }); return; }

          const partial = {};
          for (const { key, value } of hint.cells) partial[key] = value;
          renderOverlay(cellMap, partial, '#f4a261');

          sendResponse({
            ok:             true,
            hadError:       hint.hadError,
            classification: hint.classification,
            hintsRemaining: _hintMgr.hintsRemaining(),
          });
          break;
        }

        case 'clear': {
          clearOverlays();
          _solution = null;
          _hintMgr  = null;
          sendResponse({ ok: true });
          break;
        }

        case 'getBoardState': {
          const gameData = await waitForGameData();
          const cellMap  = buildCellMap(gameData, difficulty);
          sendResponse({ ok: true, boardState: getCurrentBoardState(cellMap) });
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown action: ${msg.action}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});