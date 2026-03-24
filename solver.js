/**
 * solver.js
 * JavaScript port of the Python GraphMultiProcess solver.
 * Loaded before content.js so PipsSolver is available globally.
 */

class PipsSolver {

  // ---------------------------------------------------------------------------
  // Node
  // ---------------------------------------------------------------------------

    static Node(point, type = null, target = null) {
        return {
        p: point,           // [row, col]
        type,               // 'empty'|'equals'|'unequal'|'sum'|'less'|'greater'
        target,             // numeric target or null
        neighbors: [],      // filled by buildEdges
        value: null,        // pip value once placed
        };
    }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

    constructor(puzzleData, difficulty = 'easy') {
        this.nodes         = [];
        this.dominoes      = [];
        this.nodeToRegion  = new Map();   // "row,col" → Node[]
        this._build(puzzleData, difficulty);
    }

    _build(data, difficulty) {
        const d = data[difficulty];

        // 1. nodes
        for (const region of d.regions) {
        for (const idx of region.indices) {
            const node = PipsSolver.Node(
            idx,
            region.type   ?? null,
            region.target ?? null
            );
            this.nodes.push(node);
        }
        }

        // 2. edges
        for (const a of this.nodes) {
        for (const b of this.nodes) {
            const dr = Math.abs(a.p[0] - b.p[0]);
            const dc = Math.abs(a.p[1] - b.p[1]);
            if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
            a.neighbors.push(b);
            }
        }
        }

        // 3. region cache
        const posMap = new Map(this.nodes.map(n => [`${n.p[0]},${n.p[1]}`, n]));
        for (const region of d.regions) {
        const regionNodes = region.indices
            .map(idx => posMap.get(`${idx[0]},${idx[1]}`))
            .filter(Boolean);
        for (const node of regionNodes) {
            this.nodeToRegion.set(`${node.p[0]},${node.p[1]}`, regionNodes);
        }
        }

        // 4. dominoes  e.g. ["11","03","26"]
        this.dominoes = d.dominoes;
    }

  // ---------------------------------------------------------------------------
  // Public solve entry-point
  // ---------------------------------------------------------------------------

    /**
   * Attempt to solve the puzzle.
   * @param {number} timeoutMs  - max milliseconds per attempt
   * @param {number} attempts   - number of random restarts
   * @returns {boolean|null}    - true=solved, false=failed, null=timeout
   */
    solve(timeoutMs = 8000, attempts = 6) {
        for (let i = 0; i < attempts; i++) {
        this._resetValues();
        this._rng = this._makeRng(i * 1000 + this.nodes.length);
        const result = this._solveOnce(timeoutMs);
        if (result === true) return true;
        }
        return null;
    }

  // ---------------------------------------------------------------------------
  // Core backtracking
  // ---------------------------------------------------------------------------

    _solveOnce(timeoutMs) {
        if (this.nodes.length % 2 !== 0) return null;
        this._resetValues();

        const deadline   = Date.now() + timeoutMs;
        const timedOut   = { v: false };
        let   calls      = 0;

        const findRegion = (node) =>
        this.nodeToRegion.get(`${node.p[0]},${node.p[1]}`) ?? [node];

        // ── constraint checker ──────────────────────────────────────────────────
        const checkConstraint = (node, val, regionNodes) => {
        const placed    = regionNodes.filter(n => n.value !== null).map(n => n.value);
        const all       = [...placed, val];
        const emptyLeft = regionNodes.filter(n => n.value === null).length;
        const isFull    = emptyLeft === 1;

        switch (node.type) {
            case 'empty':   return true;
            case null:      return true;

            case 'equals':
            return new Set(all).size === 1;

            case 'unequal':
            return new Set(all).size === all.length;

            case 'less':
            if (node.target == null) return true;
            return all.reduce((a, b) => a + b, 0) < node.target;

            case 'greater':
            if (node.target == null) return true;
            if (!isFull) return true;
            return all.reduce((a, b) => a + b, 0) > node.target;

            case 'sum':
            if (node.target == null) return true;
            const s = all.reduce((a, b) => a + b, 0);
            return s <= node.target && (!isFull || s === node.target);

            default: return true;
        }
        };

        const canPlace = (n1, n2, domino) => {
        return checkConstraint(n1, +domino[0], findRegion(n1)) &&
                checkConstraint(n2, +domino[1], findRegion(n2));
        };

        // ── MRV: most constrained node ──────────────────────────────────────────
        const nextEmpty = () => {
        let best = null, bestCount = Infinity;
        for (const node of this.nodes) {
            if (node.value !== null) continue;
            const cnt = node.neighbors.filter(n => n.value === null).length;
            if (cnt === 0) return node;   // immediate dead-end
            if (cnt < bestCount) { bestCount = cnt; best = node; }
        }
        return best;
        };

        // ── dead-end check ───────────────────────────────────────────────────────
        const hasDeadEnd = () => {
        for (const node of this.nodes) {
            if (node.value !== null) continue;
            if (node.neighbors.every(n => n.value !== null)) return true;
        }
        return false;
        };

        // ── place domino ─────────────────────────────────────────────────────────
        const placeDomino = (node, remaining) => {
        const emptyNeighbors = node.neighbors
            .filter(n => n.value === null)
            .sort((a, b) =>
            a.neighbors.filter(x => x.value === null).length -
            b.neighbors.filter(x => x.value === null).length
            );
        if (!emptyNeighbors.length) return false;

        const shuffled = this._shuffle([...remaining]);

        for (const domino of shuffled) {
            const orientations = [domino];
            if (domino[0] !== domino[1]) orientations.push(domino[1] + domino[0]);

            for (const ori of orientations) {
            for (const nb of emptyNeighbors) {
                if (canPlace(node, nb, ori)) {
                node.value = +ori[0];
                nb.value   = +ori[1];

                if (!hasDeadEnd()) {
                    const next = remaining.filter(d => d !== domino);
                    if (backtrack(next)) return true;
                }

                node.value = null;
                nb.value   = null;
                }
            }
            }
        }
        return false;
        };

        // ── backtrack ────────────────────────────────────────────────────────────
        const backtrack = (remaining) => {
        if (++calls % 200 === 0) {
            if (Date.now() > deadline) { timedOut.v = true; return false; }
        }

        const node = nextEmpty();
        if (!node) return remaining.length === 0;
        return placeDomino(node, remaining);
        };

        const ok = backtrack([...this.dominoes]);
        if (timedOut.v) return null;
        return ok;
    }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

    _resetValues() {
        for (const n of this.nodes) n.value = null;
    }

  /** Simple seeded PRNG (mulberry32) so each attempt is deterministic. */
    _makeRng(seed) {
        let s = seed >>> 0;
        return () => {
        s += 0x6d2b79f5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    _shuffle(arr) {
        const rng = this._rng ?? Math.random;
        for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

  // ---------------------------------------------------------------------------
  // Extract solution as a plain map  "row,col" → value
  // ---------------------------------------------------------------------------

    getSolution() {
        const sol = {};
        for (const n of this.nodes) {
        if (n.value !== null) sol[`${n.p[0]},${n.p[1]}`] = n.value;
        }
        return sol;
    }
}