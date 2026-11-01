/*
 * Game engine: board, pieces, rotation (SRS with wall kicks), 7-bag
 * randomizer, hold, gravity, lock delay, line clears and scoring.
 * Contains no rendering or DOM code.
 */
(function (global) {
  'use strict';

  const COLS = 10;
  const VISIBLE_ROWS = 20;
  const BUFFER_ROWS = 20;                 // hidden rows above the visible field
  const ROWS = VISIBLE_ROWS + BUFFER_ROWS;
  const LOCK_DELAY = 500;                 // ms a grounded piece waits before locking
  const MAX_LOCK_RESETS = 15;             // moves/rotations that may reset the lock timer
  const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  const BASE_SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  };

  function rotateMatrixCW(m) {
    const n = m.length;
    const out = [];
    for (let y = 0; y < n; y++) {
      out.push([]);
      for (let x = 0; x < n; x++) out[y][x] = m[n - 1 - x][y];
    }
    return out;
  }

  function matrixToCells(m) {
    const cells = [];
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) if (m[y][x]) cells.push([x, y]);
    }
    return cells;
  }

  // ROTATIONS[type][rotationState] -> list of [x, y] offsets inside the bounding box.
  const ROTATIONS = {};
  for (const t of PIECE_TYPES) {
    let m = BASE_SHAPES[t];
    ROTATIONS[t] = [];
    for (let r = 0; r < 4; r++) {
      ROTATIONS[t].push(matrixToCells(m));
      m = rotateMatrixCW(m);
    }
  }

  // SRS wall-kick data, written with +y = up (as in the usual tables).
  // Converted to screen coordinates (+y = down) when applied.
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };
  const KICKS_180 = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]];

  // Seconds per row at a given level (standard marathon curve).
  function gravityInterval(level) {
    const l = Math.min(level, 20);
    return Math.pow(0.8 - (l - 1) * 0.007, l - 1) * 1000;
  }

  class Game {
    constructor(onEvent) {
      this.onEvent = onEvent || function () {};
      this.reset(1);
    }

    reset(startLevel) {
      this.board = [];
      for (let y = 0; y < ROWS; y++) this.board.push(new Array(COLS).fill(0));
      this.startLevel = Math.max(1, startLevel | 0);
      this.level = this.startLevel;
      this.score = 0;
      this.lines = 0;
      this.combo = -1;
      this.b2b = false;
      this.bag = [];
      this.queue = [];
      this.hold = null;
      this.holdUsed = false;
      this.active = null;
      this.over = false;
      this.softDropping = false;
      this.gravityAcc = 0;
      this.elapsed = 0;
      this.fillQueue();
      this.spawn(this.queue.shift());
    }

    fillQueue() {
      while (this.queue.length < 7) {
        if (this.bag.length === 0) {
          this.bag = PIECE_TYPES.slice();
          for (let i = this.bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
          }
        }
        this.queue.push(this.bag.pop());
      }
    }

    cellFilled(x, y) {
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y < 0) return false;
      return this.board[y][x] !== 0;
    }

    collides(type, rot, px, py) {
      for (const [cx, cy] of ROTATIONS[type][rot]) {
        if (this.cellFilled(px + cx, py + cy)) return true;
      }
      return false;
    }

    spawn(type) {
      this.fillQueue();
      const piece = { type, rot: 0, x: type === 'O' ? 4 : 3, y: BUFFER_ROWS - 1 };
      this.active = piece;
      this.lockTimer = 0;
      this.lockResets = 0;
      this.lastAction = null;
      this.lastKick = 0;
      this.gravityAcc = 0;
      if (this.collides(type, 0, piece.x, piece.y)) {
        this.gameOver();
        return;
      }
      // Pieces drop one row immediately after spawning.
      if (!this.collides(type, 0, piece.x, piece.y + 1)) piece.y++;
      this.lowestY = piece.y;
    }

    gameOver() {
      this.over = true;
      this.onEvent({ type: 'gameover', score: this.score });
    }

    isGrounded() {
      const p = this.active;
      return this.collides(p.type, p.rot, p.x, p.y + 1);
    }

    afterSuccessfulMove() {
      const p = this.active;
      if (p.y > this.lowestY) {
        this.lowestY = p.y;
        this.lockResets = 0;
        this.lockTimer = 0;
      } else if (this.lockResets < MAX_LOCK_RESETS) {
        this.lockResets++;
        this.lockTimer = 0;
      }
    }

    move(dx) {
      if (this.over || !this.active) return false;
      const p = this.active;
      if (this.collides(p.type, p.rot, p.x + dx, p.y)) return false;
      p.x += dx;
      this.lastAction = 'move';
      this.afterSuccessfulMove();
      return true;
    }

    // dir: 1 = clockwise, -1 = counter-clockwise, 2 = 180 degrees
    rotate(dir) {
      if (this.over || !this.active) return false;
      const p = this.active;
      if (p.type === 'O') return false;
      const from = p.rot;
      const to = (from + (dir === 2 ? 2 : dir) + 4) % 4;
      let kicks;
      if (dir === 2) kicks = KICKS_180;
      else kicks = (p.type === 'I' ? KICKS_I : KICKS_JLSTZ)[from + '>' + to];
      for (let i = 0; i < kicks.length; i++) {
        const nx = p.x + kicks[i][0];
        const ny = p.y - kicks[i][1];
        if (!this.collides(p.type, to, nx, ny)) {
          p.x = nx;
          p.y = ny;
          p.rot = to;
          this.lastAction = 'rotate';
          this.lastKick = i;
          this.afterSuccessfulMove();
          return true;
        }
      }
      return false;
    }

    ghostY() {
      const p = this.active;
      let y = p.y;
      while (!this.collides(p.type, p.rot, p.x, y + 1)) y++;
      return y;
    }

    hardDrop() {
      if (this.over || !this.active) return;
      const p = this.active;
      const target = this.ghostY();
      const dist = target - p.y;
      if (dist > 0) this.lastAction = 'drop';
      p.y = target;
      this.score += dist * 2;
      this.lock();
    }

    holdPiece() {
      if (this.over || !this.active || this.holdUsed) return false;
      const current = this.active.type;
      if (this.hold === null) {
        this.hold = current;
        this.spawn(this.queue.shift());
      } else {
        const next = this.hold;
        this.hold = current;
        this.spawn(next);
      }
      this.holdUsed = true;
      return true;
    }

    detectTSpin() {
      const p = this.active;
      if (p.type !== 'T' || this.lastAction !== 'rotate') return null;
      const c = [
        this.cellFilled(p.x, p.y),         // top-left
        this.cellFilled(p.x + 2, p.y),     // top-right
        this.cellFilled(p.x + 2, p.y + 2), // bottom-right
        this.cellFilled(p.x, p.y + 2),     // bottom-left
      ];
      const count = c.filter(Boolean).length;
      if (count < 3) return null;
      // Corners on the side the T points to, per rotation state.
      const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
      if ((c[front[0]] && c[front[1]]) || this.lastKick === 4) return 'full';
      return 'mini';
    }

    lock() {
      const p = this.active;
      const tspin = this.detectTSpin();
      let allHidden = true;
      for (const [cx, cy] of ROTATIONS[p.type][p.rot]) {
        const x = p.x + cx;
        const y = p.y + cy;
        if (y >= 0) this.board[y][x] = 1;
        if (y >= BUFFER_ROWS) allHidden = false;
      }

      // Clear full lines.
      let cleared = 0;
      for (let y = ROWS - 1; y >= 0; y--) {
        if (this.board[y].every(v => v !== 0)) {
          this.board.splice(y, 1);
          cleared++;
        }
      }
      for (let i = 0; i < cleared; i++) this.board.unshift(new Array(COLS).fill(0));

      this.applyScore(cleared, tspin);

      this.active = null;
      this.holdUsed = false;
      if (allHidden) {
        this.gameOver();
        return;
      }
      this.spawn(this.queue.shift());
    }

    applyScore(cleared, tspin) {
      const lvl = this.level;
      let base = 0;
      let difficult = false;
      let label = '';
      const names = ['', 'Single', 'Double', 'Triple', 'Quad'];

      if (tspin === 'full') {
        base = [400, 800, 1200, 1600][cleared];
        difficult = cleared > 0;
        label = 'T-Spin' + (cleared ? ' ' + names[cleared] : '');
      } else if (tspin === 'mini') {
        base = [100, 200, 400][cleared];
        difficult = cleared > 0;
        label = 'Mini T-Spin' + (cleared ? ' ' + names[cleared] : '');
      } else {
        base = [0, 100, 300, 500, 800][cleared];
        difficult = cleared === 4;
        label = names[cleared];
      }

      let b2bApplied = false;
      if (cleared > 0) {
        if (difficult && this.b2b) {
          base = Math.floor(base * 1.5);
          b2bApplied = true;
        }
        this.b2b = difficult;
        this.combo++;
      } else {
        this.combo = -1;
      }

      let points = base * lvl;
      if (this.combo > 0) points += 50 * this.combo * lvl;

      let perfect = false;
      if (cleared > 0 && this.board.every(row => row.every(v => v === 0))) {
        perfect = true;
        points += [800, 1200, 1800, 2000][cleared - 1] * lvl;
      }

      this.score += points;
      this.lines += cleared;
      const newLevel = this.startLevel + Math.floor(this.lines / 10);
      const leveledUp = newLevel > this.level;
      this.level = newLevel;

      if (label || cleared > 0) {
        this.onEvent({
          type: 'clear',
          lines: cleared,
          label,
          b2b: b2bApplied,
          combo: this.combo,
          perfect,
          points,
          leveledUp,
          level: this.level,
        });
      }
    }

    // Advance the game by dt milliseconds. softDropFactor of Infinity = instant soft drop.
    update(dt, softDropFactor) {
      if (this.over || !this.active) return;
      this.elapsed += dt;
      const p = this.active;
      const interval = gravityInterval(this.level);

      if (this.softDropping && softDropFactor === Infinity) {
        while (!this.isGrounded()) {
          p.y++;
          this.score += 1;
        }
        this.afterGravity();
      } else {
        const factor = this.softDropping ? Math.max(1, softDropFactor) : 1;
        this.gravityAcc += dt * factor;
        let steps = 0;
        while (this.gravityAcc >= interval && steps < ROWS) {
          steps++;
          if (this.isGrounded()) {
            this.gravityAcc = 0;
            break;
          }
          this.gravityAcc -= interval;
          p.y++;
          if (this.softDropping) this.score += 1;
          this.lastAction = 'fall';
        }
        this.afterGravity();
      }

      if (this.active && this.isGrounded()) {
        this.lockTimer += dt;
        if (this.lockTimer >= LOCK_DELAY) this.lock();
      }
    }

    afterGravity() {
      const p = this.active;
      if (p.y > this.lowestY) {
        this.lowestY = p.y;
        this.lockResets = 0;
        this.lockTimer = 0;
      }
    }
  }

  global.BlockEngine = {
    Game,
    ROTATIONS,
    COLS,
    VISIBLE_ROWS,
    BUFFER_ROWS,
    ROWS,
    PIECE_TYPES,
  };
})(window);
