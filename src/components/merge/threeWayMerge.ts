// 三方合并模型，对齐 IntelliJ IDEA Merge 对话框：
// 中间栏初始对应基准版本；左右不重叠的改动可单独采用/忽略；
// 同一基准区间两边都改过才是冲突。简单冲突指同一行两端互不重叠的修改。

export type ChunkKind = 'context' | 'left' | 'right' | 'conflict' | 'same';
export type SideState = 'pending' | 'accepted' | 'ignored';
export type ResultSource = 'context' | 'base' | 'left' | 'right' | 'both' | 'simple' | 'manual';

export interface WordSpan {
  type: 'same' | 'add';
  text: string;
}

export interface MergeChunk {
  id: string;
  kind: ChunkKind;
  baseStart: number;
  baseEnd: number;
  baseLines: string[];
  leftLines: string[];
  rightLines: string[];
  leftLineStart: number;
  rightLineStart: number;
  leftState: SideState;
  rightState: SideState;
  manual: string[] | null;
  simple: string[] | null;
  useSimple: boolean;
}

export interface MergeSession {
  mode: 'merge' | 'binary' | 'too-large' | 'raw';
  chunks: MergeChunk[];
  ending: '\n' | '\r\n';
  trailing: boolean;
  base: string;
  ours: string;
  theirs: string;
  baseLines: string[];
  oursLines: string[];
  theirsLines: string[];
  note?: string;
}

export interface MergeStats {
  conflicts: number;
  unresolved: number;
  pendingNonConflict: number;
  simpleReady: number;
  leftChanges: number;
  rightChanges: number;
}

export interface ChunkResult {
  lines: string[];
  source: ResultSource;
}

interface LineDiffOp {
  type: 'equal' | 'change';
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

interface Span {
  base0: number;
  base1: number;
  lines: string[];
}

const DP_CELL_LIMIT = 2_500_000;
const LINE_LIMIT = 20_000;
const SIMPLE_LINE_LIMIT = 4_000;

export function splitText(text: string): { lines: string[]; ending: '\n' | '\r\n'; trailing: boolean } {
  if (text === '') return { lines: [], ending: '\n', trailing: false };
  const crlf = (text.match(/\r\n/g) || []).length;
  const newlines = (text.match(/\n/g) || []).length;
  const ending: '\n' | '\r\n' = crlf > newlines - crlf ? '\r\n' : '\n';
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trailing = normalized.endsWith('\n');
  const parts = normalized.split('\n');
  if (trailing) parts.pop();
  return { lines: parts, ending, trailing };
}

export function joinText(lines: string[], ending: '\n' | '\r\n', trailing: boolean): string {
  if (lines.length === 0) return '';
  const body = lines.join(ending);
  return trailing ? body + ending : body;
}

export function isBinaryText(text: string): boolean {
  return text.includes('\0');
}

export function linesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function coalesce(raw: Array<'equal' | 'delete' | 'insert'>): LineDiffOp[] {
  const ops: LineDiffOp[] = [];
  let i = 0;
  let a = 0;
  let b = 0;
  while (i < raw.length) {
    if (raw[i] === 'equal') {
      const a0 = a;
      const b0 = b;
      while (i < raw.length && raw[i] === 'equal') {
        a++;
        b++;
        i++;
      }
      ops.push({ type: 'equal', a0, a1: a, b0, b1: b });
      continue;
    }
    const a0 = a;
    const b0 = b;
    while (i < raw.length && raw[i] !== 'equal') {
      if (raw[i] === 'delete') a++;
      else b++;
      i++;
    }
    ops.push({ type: 'change', a0, a1: a, b0, b1: b });
  }
  return ops;
}

function lcsDiff(a: string[], b: string[]): LineDiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: 'change', a0: 0, a1: 0, b0: 0, b1: m }];
  if (m === 0) return [{ type: 'change', a0: 0, a1: n, b0: 0, b1: 0 }];
  const decision = new Uint8Array(n * m);
  let prev = new Uint32Array(m + 1);
  let curr = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    curr[m] = 0;
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        curr[j] = prev[j + 1] + 1;
        decision[i * m + j] = 0;
      } else if (prev[j] >= curr[j + 1]) {
        curr[j] = prev[j];
        decision[i * m + j] = 1;
      } else {
        curr[j] = curr[j + 1];
        decision[i * m + j] = 2;
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  const raw: Array<'equal' | 'delete' | 'insert'> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push('equal');
      i++;
      j++;
    } else if (decision[i * m + j] === 1) {
      raw.push('delete');
      i++;
    } else {
      raw.push('insert');
      j++;
    }
  }
  while (i < n) {
    raw.push('delete');
    i++;
  }
  while (j < m) {
    raw.push('insert');
    j++;
  }
  return coalesce(raw);
}

function myersDiff(a: string[], b: string[]): LineDiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: 'change', a0: 0, a1: 0, b0: 0, b1: m }];
  if (m === 0) return [{ type: 'change', a0: 0, a1: n, b0: 0, b1: 0 }];
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let done = -1;
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice());
        done = d;
        break;
      }
    }
    if (done >= 0) break;
    trace.push(v.slice());
  }
  if (done < 0) return lcsDiff(a, b);
  const raw: Array<'equal' | 'delete' | 'insert'> = [];
  let x = n;
  let y = m;
  for (let d = done; d > 0; d--) {
    const snapshot = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && snapshot[offset + k - 1] < snapshot[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = snapshot[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      raw.push('equal');
      x--;
      y--;
    }
    if (x === prevX) raw.push('insert');
    else raw.push('delete');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    raw.push('equal');
    x--;
    y--;
  }
  while (x > 0) {
    raw.push('delete');
    x--;
  }
  while (y > 0) {
    raw.push('insert');
    y--;
  }
  raw.reverse();
  return coalesce(raw);
}

export function diffLines(a: string[], b: string[]): LineDiffOp[] {
  let start = 0;
  const maxStart = Math.min(a.length, b.length);
  while (start < maxStart && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  const aMid = a.slice(start, aEnd);
  const bMid = b.slice(start, bEnd);
  const mid = aMid.length * bMid.length > DP_CELL_LIMIT ? myersDiff(aMid, bMid) : lcsDiff(aMid, bMid);
  const ops = mid.map(op => ({
    type: op.type,
    a0: op.a0 + start,
    a1: op.a1 + start,
    b0: op.b0 + start,
    b1: op.b1 + start,
  }));
  const result: LineDiffOp[] = [];
  if (start > 0) result.push({ type: 'equal', a0: 0, a1: start, b0: 0, b1: start });
  result.push(...ops);
  if (a.length > aEnd) result.push({ type: 'equal', a0: aEnd, a1: a.length, b0: bEnd, b1: b.length });
  return result;
}

function spansFromDiff(base: string[], side: string[]): Span[] {
  const spans: Span[] = [];
  for (const op of diffLines(base, side)) {
    if (op.type === 'equal') continue;
    spans.push({ base0: op.a0, base1: op.a1, lines: side.slice(op.b0, op.b1) });
  }
  return spans;
}

function rangesOverlap(a: Span, b: Span): boolean {
  if (a.base1 < b.base0 || b.base1 < a.base0) return false;
  // 仅在端点相接时，只有“两边都在同一位置插入”才算冲突；修改与相邻插入可以自动合并。
  if (a.base1 === b.base0 || b.base1 === a.base0) {
    const aIns = a.base0 === a.base1;
    const bIns = b.base0 === b.base1;
    return aIns && bIns && a.base0 === b.base0;
  }
  return true;
}

function sideLinesForRange(base: string[], spans: Span[], start: number, end: number): string[] {
  const lines: string[] = [];
  let cursor = start;
  for (const span of spans) {
    if (span.base0 > cursor) lines.push(...base.slice(cursor, span.base0));
    lines.push(...span.lines);
    cursor = Math.max(cursor, span.base1);
  }
  if (cursor < end) lines.push(...base.slice(cursor, end));
  return lines;
}

function tokenize(text: string): string[] {
  return text.split(/(\s+|[^\p{L}\p{N}_]+)/u).filter(part => part.length > 0);
}

function charEdits(base: string, next: string): Array<{ base0: number; base1: number; text: string }> {
  const ops = diffLines(base.split(''), next.split(''));
  const edits = [];
  for (const op of ops) {
    if (op.type === 'equal') continue;
    edits.push({ base0: op.a0, base1: op.a1, text: next.slice(op.b0, op.b1) });
  }
  return edits;
}

function editsOverlap(
  left: Array<{ base0: number; base1: number }>,
  right: Array<{ base0: number; base1: number }>,
): boolean {
  for (const a of left) {
    for (const b of right) {
      if (a.base1 < b.base0 || b.base1 < a.base0) continue;
      if (a.base1 === b.base0 || b.base1 === a.base0) {
        const aIns = a.base0 === a.base1;
        const bIns = b.base0 === b.base1;
        if (aIns && bIns && a.base0 === b.base0) return true;
        continue;
      }
      return true;
    }
  }
  return false;
}

export function mergeLine(base: string, left: string, right: string): string | null {
  if (left === right) return left;
  if (left === base) return right;
  if (right === base) return left;
  if (base.length > SIMPLE_LINE_LIMIT || left.length > SIMPLE_LINE_LIMIT || right.length > SIMPLE_LINE_LIMIT) return null;
  const leftEdits = charEdits(base, left);
  const rightEdits = charEdits(base, right);
  if (editsOverlap(leftEdits, rightEdits)) return null;
  const ops = [...leftEdits, ...rightEdits].sort((a, b) => b.base0 - a.base0);
  let text = base;
  for (const op of ops) text = text.slice(0, op.base0) + op.text + text.slice(op.base1);
  return text;
}

function trySimpleMerge(baseLines: string[], leftLines: string[], rightLines: string[]): string[] | null {
  if (baseLines.length === 0 || baseLines.length !== leftLines.length || baseLines.length !== rightLines.length) return null;
  const merged: string[] = [];
  for (let i = 0; i < baseLines.length; i++) {
    const line = mergeLine(baseLines[i], leftLines[i], rightLines[i]);
    if (line === null) return null;
    merged.push(line);
  }
  if (linesEqual(merged, leftLines) || linesEqual(merged, rightLines)) return null;
  return merged;
}

function makeChunk(
  seq: number,
  kind: ChunkKind,
  start: number,
  end: number,
  baseLines: string[],
  leftLines: string[],
  rightLines: string[],
): MergeChunk {
  const conflict = kind === 'conflict';
  return {
    id: `${kind}-${start}-${end}-${seq}`,
    kind,
    baseStart: start,
    baseEnd: end,
    baseLines,
    leftLines,
    rightLines,
    leftLineStart: 1,
    rightLineStart: 1,
    leftState: conflict ? 'pending' : kind === 'right' ? 'ignored' : 'accepted',
    rightState: conflict ? 'pending' : kind === 'left' ? 'ignored' : 'accepted',
    manual: null,
    simple: conflict ? trySimpleMerge(baseLines, leftLines, rightLines) : null,
    useSimple: false,
  };
}

function assignLineNumbers(chunks: MergeChunk[]) {
  let left = 1;
  let right = 1;
  for (const chunk of chunks) {
    chunk.leftLineStart = left;
    chunk.rightLineStart = right;
    const leftCount = chunk.kind === 'right' ? chunk.baseLines.length : chunk.leftLines.length;
    const rightCount = chunk.kind === 'left' ? chunk.baseLines.length : chunk.rightLines.length;
    left += leftCount;
    right += rightCount;
  }
}

export function buildChunks(base: string[], ours: string[], theirs: string[]): MergeChunk[] {
  const left = spansFromDiff(base, ours);
  const right = spansFromDiff(base, theirs);
  const chunks: MergeChunk[] = [];
  let i = 0;
  let j = 0;
  let cursor = 0;
  let seq = 0;
  const pushContext = (to: number) => {
    if (to <= cursor) return;
    chunks.push(makeChunk(seq++, 'context', cursor, to, base.slice(cursor, to), base.slice(cursor, to), base.slice(cursor, to)));
    cursor = to;
  };
  while (i < left.length || j < right.length) {
    const L = left[i];
    const R = right[j];
    if (L && R && rangesOverlap(L, R)) {
      let start = Math.min(L.base0, R.base0);
      let end = Math.max(L.base1, R.base1);
      const leftSpans: Span[] = [];
      const rightSpans: Span[] = [];
      while (true) {
        let grew = false;
        while (i < left.length && rangesOverlap(left[i], { base0: start, base1: end, lines: [] })) {
          leftSpans.push(left[i]);
          start = Math.min(start, left[i].base0);
          end = Math.max(end, left[i].base1);
          i++;
          grew = true;
        }
        while (j < right.length && rangesOverlap(right[j], { base0: start, base1: end, lines: [] })) {
          rightSpans.push(right[j]);
          start = Math.min(start, right[j].base0);
          end = Math.max(end, right[j].base1);
          j++;
          grew = true;
        }
        if (!grew) break;
      }
      pushContext(start);
      const baseLines = base.slice(start, end);
      const leftLines = sideLinesForRange(base, leftSpans, start, end);
      const rightLines = sideLinesForRange(base, rightSpans, start, end);
      const kind: ChunkKind = linesEqual(leftLines, rightLines) ? 'same' : 'conflict';
      chunks.push(makeChunk(seq++, kind, start, end, baseLines, leftLines, rightLines));
      cursor = end;
      continue;
    }
    const takeLeft = !!L && (!R || L.base0 < R.base0 || (L.base0 === R.base0 && L.base1 <= R.base0));
    if (takeLeft && L) {
      pushContext(L.base0);
      chunks.push(makeChunk(seq++, 'left', L.base0, L.base1, base.slice(L.base0, L.base1), L.lines, base.slice(L.base0, L.base1)));
      cursor = L.base1;
      i++;
      continue;
    }
    if (R) {
      pushContext(R.base0);
      chunks.push(makeChunk(seq++, 'right', R.base0, R.base1, base.slice(R.base0, R.base1), base.slice(R.base0, R.base1), R.lines));
      cursor = R.base1;
      j++;
      continue;
    }
    break;
  }
  pushContext(base.length);
  assignLineNumbers(chunks);
  return chunks;
}

export function parseConflictMarkers(working: string): { base: string; ours: string; theirs: string } | null {
  if (!working.includes('<<<<<<<')) return null;
  const { lines, ending, trailing } = splitText(working);
  const base: string[] = [];
  const ours: string[] = [];
  const theirs: string[] = [];
  let mode: 'common' | 'ours' | 'base' | 'theirs' = 'common';
  let saw = false;
  for (const line of lines) {
    if (line.startsWith('<<<<<<<')) {
      mode = 'ours';
      saw = true;
      continue;
    }
    if (line.startsWith('|||||||') && mode === 'ours') {
      mode = 'base';
      continue;
    }
    if (line.startsWith('=======') && (mode === 'ours' || mode === 'base')) {
      mode = 'theirs';
      continue;
    }
    if (line.startsWith('>>>>>>>') && mode === 'theirs') {
      mode = 'common';
      continue;
    }
    if (mode === 'common') {
      base.push(line);
      ours.push(line);
      theirs.push(line);
    } else if (mode === 'ours') ours.push(line);
    else if (mode === 'base') base.push(line);
    else theirs.push(line);
  }
  if (!saw || mode !== 'common') return null;
  return {
    base: joinText(base, ending, trailing),
    ours: joinText(ours, ending, trailing),
    theirs: joinText(theirs, ending, trailing),
  };
}

export function createSession(base: string, ours: string, theirs: string, working = ''): MergeSession {
  const binary = [base, ours, theirs, working].some(isBinaryText);
  if (binary) {
    return {
      mode: 'binary',
      chunks: [],
      ending: '\n',
      trailing: false,
      base,
      ours,
      theirs,
      baseLines: [],
      oursLines: [],
      theirsLines: [],
      note: '二进制文件不能按行合并，请整份采用左侧或右侧。',
    };
  }
  const stagesEmpty = base === '' && ours === '' && theirs === '';
  if (stagesEmpty && working) {
    const parsed = parseConflictMarkers(working);
    if (parsed) return createSession(parsed.base, parsed.ours, parsed.theirs, '');
    const split = splitText(working);
    return {
      mode: 'raw',
      chunks: [],
      ending: split.ending,
      trailing: split.trailing,
      base,
      ours: working,
      theirs: '',
      baseLines: [],
      oursLines: split.lines,
      theirsLines: [],
      note: '读不到基准版本和左右版本，只能直接编辑工作区内容。',
    };
  }
  const baseSplit = splitText(base);
  const oursSplit = splitText(ours);
  const theirsSplit = splitText(theirs);
  const ending = ours ? oursSplit.ending : theirs ? theirsSplit.ending : baseSplit.ending;
  const trailing = ours ? oursSplit.trailing : theirs ? theirsSplit.trailing : baseSplit.trailing;
  const tooLarge = [baseSplit.lines.length, oursSplit.lines.length, theirsSplit.lines.length].some(count => count > LINE_LIMIT);
  if (tooLarge) {
    return {
      mode: 'too-large',
      chunks: [],
      ending,
      trailing,
      base,
      ours,
      theirs,
      baseLines: baseSplit.lines,
      oursLines: oursSplit.lines,
      theirsLines: theirsSplit.lines,
      note: '文件过大，已关闭逐块合并。可以整份采用左侧或右侧，或直接编辑结果。',
    };
  }
  return {
    mode: 'merge',
    chunks: buildChunks(baseSplit.lines, oursSplit.lines, theirsSplit.lines),
    ending,
    trailing,
    base,
    ours,
    theirs,
    baseLines: baseSplit.lines,
    oursLines: oursSplit.lines,
    theirsLines: theirsSplit.lines,
  };
}

function clearOverride(chunk: MergeChunk): MergeChunk {
  return { ...chunk, manual: null, useSimple: false };
}

export function acceptSide(chunk: MergeChunk, side: 'left' | 'right'): MergeChunk {
  if (chunk.kind === 'context') return chunk;
  const next = clearOverride(chunk);
  if (side === 'left') next.leftState = 'accepted';
  else next.rightState = 'accepted';
  return next;
}

export function ignoreSide(chunk: MergeChunk, side: 'left' | 'right'): MergeChunk {
  if (chunk.kind === 'context') return chunk;
  const next = clearOverride(chunk);
  if (side === 'left') next.leftState = 'ignored';
  else next.rightState = 'ignored';
  return next;
}

export function resolveUsing(chunk: MergeChunk, side: 'left' | 'right'): MergeChunk {
  if (chunk.kind !== 'conflict') return acceptSide(chunk, side);
  const next = clearOverride(chunk);
  next.leftState = side === 'left' ? 'accepted' : 'ignored';
  next.rightState = side === 'right' ? 'accepted' : 'ignored';
  return next;
}

export function acceptBoth(chunk: MergeChunk, simple = false): MergeChunk {
  if (chunk.kind !== 'conflict') return chunk;
  const next = clearOverride(chunk);
  next.leftState = 'accepted';
  next.rightState = 'accepted';
  next.useSimple = simple && !!chunk.simple;
  return next;
}

export function keepBase(chunk: MergeChunk): MergeChunk {
  if (chunk.kind === 'context') return chunk;
  const next = clearOverride(chunk);
  if (chunk.kind !== 'right') next.leftState = 'ignored';
  if (chunk.kind !== 'left') next.rightState = 'ignored';
  return next;
}

export function setManual(chunk: MergeChunk, lines: string[]): MergeChunk {
  return { ...chunk, manual: lines, useSimple: false };
}

export function clearManual(chunk: MergeChunk): MergeChunk {
  return { ...chunk, manual: null };
}

export function setSideState(chunk: MergeChunk, side: 'left' | 'right', state: SideState): MergeChunk {
  if (chunk.kind === 'context') return chunk;
  const next = clearOverride(chunk);
  if (side === 'left') next.leftState = state;
  else next.rightState = state;
  return next;
}

export function applyNonConflicting(chunks: MergeChunk[], side: 'left' | 'right' | 'all'): MergeChunk[] {
  return chunks.map(chunk => {
    if (chunk.kind === 'left' && (side === 'left' || side === 'all') && chunk.leftState === 'pending') return acceptSide(chunk, 'left');
    if (chunk.kind === 'right' && (side === 'right' || side === 'all') && chunk.rightState === 'pending') return acceptSide(chunk, 'right');
    return chunk;
  });
}

export function revertNonConflicting(chunks: MergeChunk[]): MergeChunk[] {
  return chunks.map(chunk => {
    if (chunk.manual) return chunk;
    if (chunk.kind === 'left' && chunk.leftState === 'accepted') return { ...chunk, leftState: 'pending' };
    if (chunk.kind === 'right' && chunk.rightState === 'accepted') return { ...chunk, rightState: 'pending' };
    return chunk;
  });
}

export function acceptFile(chunks: MergeChunk[], side: 'left' | 'right'): MergeChunk[] {
  return chunks.map(chunk => {
    if (chunk.kind === 'context' || chunk.kind === 'same') return chunk;
    if (chunk.kind === 'conflict') return resolveUsing(chunk, side);
    if (chunk.kind === side) return acceptSide(chunk, side);
    return keepBase(chunk);
  });
}

export function resolveSimpleConflicts(chunks: MergeChunk[]): MergeChunk[] {
  return chunks.map(chunk => (chunk.kind === 'conflict' && chunk.simple && isUnresolved(chunk) ? acceptBoth(chunk, true) : chunk));
}

export function chunkResult(chunk: MergeChunk): ChunkResult {
  if (chunk.kind === 'context') return { lines: chunk.baseLines, source: 'context' };
  if (chunk.manual) return { lines: chunk.manual, source: 'manual' };
  if (chunk.kind === 'same') return { lines: chunk.leftLines, source: 'left' };
  const leftOn = chunk.leftState === 'accepted';
  const rightOn = chunk.rightState === 'accepted';
  if (chunk.kind === 'left') return leftOn ? { lines: chunk.leftLines, source: 'left' } : { lines: chunk.baseLines, source: 'base' };
  if (chunk.kind === 'right') return rightOn ? { lines: chunk.rightLines, source: 'right' } : { lines: chunk.baseLines, source: 'base' };
  if (leftOn && rightOn) {
    if (chunk.useSimple && chunk.simple) return { lines: chunk.simple, source: 'simple' };
    if (linesEqual(chunk.leftLines, chunk.rightLines)) return { lines: chunk.leftLines, source: 'left' };
    return { lines: [...chunk.leftLines, ...chunk.rightLines], source: 'both' };
  }
  if (leftOn) return { lines: chunk.leftLines, source: 'left' };
  if (rightOn) return { lines: chunk.rightLines, source: 'right' };
  return { lines: chunk.baseLines, source: 'base' };
}

export function isUnresolved(chunk: MergeChunk): boolean {
  if (chunk.manual || chunk.kind === 'context' || chunk.kind === 'same') return false;
  if (chunk.kind === 'left') return chunk.leftState === 'pending';
  if (chunk.kind === 'right') return chunk.rightState === 'pending';
  return chunk.leftState === 'pending' || chunk.rightState === 'pending';
}

export function summarize(chunks: MergeChunk[]): MergeStats {
  const stats: MergeStats = {
    conflicts: 0,
    unresolved: 0,
    pendingNonConflict: 0,
    simpleReady: 0,
    leftChanges: 0,
    rightChanges: 0,
  };
  for (const chunk of chunks) {
    if (chunk.kind === 'left' || chunk.kind === 'same') stats.leftChanges++;
    if (chunk.kind === 'right' || chunk.kind === 'same') stats.rightChanges++;
    if (chunk.kind === 'conflict') {
      stats.conflicts++;
      if (chunk.simple && isUnresolved(chunk)) stats.simpleReady++;
    }
    if (isUnresolved(chunk)) {
      stats.unresolved++;
      if (chunk.kind !== 'conflict') stats.pendingNonConflict++;
    }
  }
  return stats;
}

export function resultLines(chunks: MergeChunk[]): string[] {
  const lines: string[] = [];
  for (const chunk of chunks) lines.push(...chunkResult(chunk).lines);
  return lines;
}

export function resultText(session: MergeSession, chunks: MergeChunk[], raw: string | null): string {
  if (raw !== null) return raw;
  if (session.mode === 'binary' || session.mode === 'raw') return session.ours;
  const lines = resultLines(chunks);
  if (linesEqual(lines, session.oursLines)) return session.ours;
  if (linesEqual(lines, session.theirsLines)) return session.theirs;
  if (linesEqual(lines, session.baseLines)) return session.base;
  return joinText(lines, session.ending, session.trailing);
}

export function wordDiffAfter(before: string, after: string): WordSpan[] | null {
  if (before === after || before.length > 2000 || after.length > 2000) return null;
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > 500 || b.length > 500) return null;
  const ops = diffLines(a, b);
  const spans: WordSpan[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      const text = b.slice(op.b0, op.b1).join('');
      if (text) spans.push({ type: 'same', text });
    } else {
      const text = b.slice(op.b0, op.b1).join('');
      if (text) spans.push({ type: 'add', text });
    }
  }
  return spans.length ? spans : null;
}

export function chunkLabel(chunk: MergeChunk): string {
  if (chunk.kind === 'conflict') return 'Conflict';
  if (chunk.kind === 'same') return 'Same change';
  const lines = chunk.kind === 'left' ? chunk.leftLines : chunk.rightLines;
  const base = chunk.baseLines;
  if (base.length === 0) return `Added ${lines.length}`;
  if (lines.length === 0) return `Deleted ${base.length}`;
  return `Modified`;
}

export function hasConflictMarkers(text: string): boolean {
  return text.includes('<<<<<<<') || text.includes('>>>>>>>');
}
