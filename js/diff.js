/**
 * Line and word diffing.
 *
 * The line pass is a classic longest-common-subsequence walk. To keep memory
 * sane on large inputs it first trims the common prefix and suffix — in
 * practice most real diffs are a handful of changed lines inside two otherwise
 * identical files, so the LCS table only ever sees the interesting middle.
 *
 * Changed regions are then paired up and re-diffed at word granularity, which
 * is what makes a one-character edit read as a one-character edit rather than
 * as a whole rewritten line.
 */
(function (global) {
  'use strict';

  /** Longest common subsequence table walk. Returns ops: 'eq' | 'del' | 'ins'. */
  function lcsDiff(a, b) {
    const n = a.length;
    const m = b.length;
    const table = new Uint32Array((n + 1) * (m + 1));
    const at = (i, j) => i * (m + 1) + j;

    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[at(i, j)] = a[i] === b[j]
          ? table[at(i + 1, j + 1)] + 1
          : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
      }
    }

    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        ops.push({ op: 'eq', a: a[i], b: b[j], ai: i, bi: j });
        i++; j++;
      } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
        ops.push({ op: 'del', a: a[i], ai: i });
        i++;
      } else {
        ops.push({ op: 'ins', b: b[j], bi: j });
        j++;
      }
    }
    while (i < n) ops.push({ op: 'del', a: a[i], ai: i++ });
    while (j < m) ops.push({ op: 'ins', b: b[j], bi: j++ });
    return ops;
  }

  const MAX_CELLS = 4_000_000; // ~16MB of Uint32 — beyond this we fall back.

  function diffLines(aText, bText, options) {
    const opts = Object.assign({ ignoreWhitespace: false, ignoreCase: false }, options);
    const a = aText.split('\n');
    const b = bText.split('\n');

    const key = (line) => {
      let k = line;
      if (opts.ignoreWhitespace) k = k.replace(/\s+/g, ' ').trim();
      if (opts.ignoreCase) k = k.toLowerCase();
      return k;
    };

    const ka = a.map(key);
    const kb = b.map(key);

    // Trim the identical head and tail before running the expensive middle.
    let head = 0;
    while (head < ka.length && head < kb.length && ka[head] === kb[head]) head++;

    let tail = 0;
    while (
      tail < ka.length - head &&
      tail < kb.length - head &&
      ka[ka.length - 1 - tail] === kb[kb.length - 1 - tail]
    ) tail++;

    const midA = ka.slice(head, ka.length - tail);
    const midB = kb.slice(head, kb.length - tail);

    let midOps;
    if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
      // Degenerate case: treat the middle as a wholesale replacement rather
      // than allocating a table we cannot afford.
      midOps = [
        ...midA.map((_, n) => ({ op: 'del', ai: n })),
        ...midB.map((_, n) => ({ op: 'ins', bi: n })),
      ];
    } else {
      midOps = lcsDiff(midA, midB);
    }

    const ops = [];
    for (let n = 0; n < head; n++) ops.push({ op: 'eq', ai: n, bi: n });
    midOps.forEach((o) => {
      ops.push({
        op: o.op,
        ai: o.ai === undefined ? undefined : o.ai + head,
        bi: o.bi === undefined ? undefined : o.bi + head,
      });
    });
    for (let n = 0; n < tail; n++) {
      ops.push({ op: 'eq', ai: ka.length - tail + n, bi: kb.length - tail + n });
    }

    return { ops, a, b };
  }

  /** Split into words while keeping the separators, so joins round-trip exactly. */
  function tokenize(line) {
    return line.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
  }

  function diffWords(aLine, bLine) {
    const a = tokenize(aLine);
    const b = tokenize(bLine);
    if (a.length * b.length > 250_000) {
      return { a: [{ text: aLine, changed: true }], b: [{ text: bLine, changed: true }] };
    }
    const ops = lcsDiff(a, b);
    const outA = [];
    const outB = [];
    ops.forEach((o) => {
      if (o.op === 'eq') {
        outA.push({ text: o.a, changed: false });
        outB.push({ text: o.b, changed: false });
      } else if (o.op === 'del') {
        outA.push({ text: o.a, changed: true });
      } else {
        outB.push({ text: o.b, changed: true });
      }
    });
    return { a: merge(outA), b: merge(outB) };
  }

  /** Collapse adjacent runs with the same changed flag into single spans. */
  function merge(parts) {
    const out = [];
    parts.forEach((p) => {
      const last = out[out.length - 1];
      if (last && last.changed === p.changed) last.text += p.text;
      else out.push({ text: p.text, changed: p.changed });
    });
    return out;
  }

  /**
   * Group the op stream into aligned rows. Runs of del immediately followed by
   * ins are zipped into 'mod' rows so the two sides line up visually.
   */
  function alignRows(result) {
    const { ops, a, b } = result;
    const rows = [];
    let i = 0;

    while (i < ops.length) {
      const op = ops[i];
      if (op.op === 'eq') {
        rows.push({ kind: 'eq', a: a[op.ai], b: b[op.bi], an: op.ai + 1, bn: op.bi + 1 });
        i++;
        continue;
      }

      const dels = [];
      const inss = [];
      while (i < ops.length && ops[i].op === 'del') dels.push(ops[i++]);
      while (i < ops.length && ops[i].op === 'ins') inss.push(ops[i++]);

      const pairs = Math.min(dels.length, inss.length);
      for (let n = 0; n < pairs; n++) {
        const aLine = a[dels[n].ai];
        const bLine = b[inss[n].bi];
        const words = diffWords(aLine, bLine);
        rows.push({
          kind: 'mod',
          a: aLine, b: bLine,
          an: dels[n].ai + 1, bn: inss[n].bi + 1,
          aWords: words.a, bWords: words.b,
        });
      }
      for (let n = pairs; n < dels.length; n++) {
        rows.push({ kind: 'del', a: a[dels[n].ai], an: dels[n].ai + 1 });
      }
      for (let n = pairs; n < inss.length; n++) {
        rows.push({ kind: 'ins', b: b[inss[n].bi], bn: inss[n].bi + 1 });
      }
    }

    return rows;
  }

  function summarize(rows) {
    return rows.reduce((acc, r) => {
      if (r.kind === 'ins') acc.added++;
      else if (r.kind === 'del') acc.removed++;
      else if (r.kind === 'mod') { acc.changed++; }
      else acc.unchanged++;
      return acc;
    }, { added: 0, removed: 0, changed: 0, unchanged: 0 });
  }

  /** Render the rows as a unified diff, the format `git diff` prints. */
  function toUnified(rows, aName, bName, context) {
    const lines = [];
    const ctx = context === undefined ? 3 : context;
    const interesting = rows.map((r) => r.kind !== 'eq');

    const keep = rows.map((_, n) =>
      interesting.slice(Math.max(0, n - ctx), n + ctx + 1).some(Boolean)
    );

    lines.push(`--- ${aName}`, `+++ ${bName}`);
    let n = 0;
    while (n < rows.length) {
      if (!keep[n]) { n++; continue; }
      const start = n;
      while (n < rows.length && keep[n]) n++;
      const chunk = rows.slice(start, n);
      const aStart = chunk.find((r) => r.an)?.an ?? 0;
      const bStart = chunk.find((r) => r.bn)?.bn ?? 0;
      const aCount = chunk.filter((r) => r.an).length;
      const bCount = chunk.filter((r) => r.bn).length;
      lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
      chunk.forEach((r) => {
        if (r.kind === 'eq') lines.push(' ' + r.a);
        else if (r.kind === 'del') lines.push('-' + r.a);
        else if (r.kind === 'ins') lines.push('+' + r.b);
        else { lines.push('-' + r.a); lines.push('+' + r.b); }
      });
    }
    return lines.join('\n');
  }

  global.DiffDeck = { diffLines, diffWords, alignRows, summarize, toUnified };
})(window);
