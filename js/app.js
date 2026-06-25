(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const { diffLines, alignRows, summarize, toUnified } = window.DiffDeck;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  let view = 'split';
  let rows = [];
  const expandedGaps = new Set(); // start-indices of gaps the user opened

  const SAMPLE_LEFT = `function retry(fn, attempts) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

const config = {
  timeout: 5000,
  retries: 3,
  verbose: false,
};`;

  const SAMPLE_RIGHT = `async function retry(fn, attempts, backoffMs = 100) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await sleep(backoffMs * 2 ** i);
    }
  }
  throw lastError;
}

const config = {
  timeout: 8000,
  retries: 5,
  verbose: false,
  backoffMs: 100,
};`;

  function words(parts) {
    if (!parts) return null;
    return parts.map((p) => p.changed
      ? `<span class="w">${esc(p.text)}</span>`
      : esc(p.text)).join('');
  }

  /** Replace long runs of unchanged rows with a single expandable marker. */
  function withCollapse(list) {
    if (!$('collapse').checked) return list.map((r) => ({ type: 'row', row: r }));
    const CONTEXT = 3;
    const interesting = list.map((r) => r.kind !== 'eq');
    const keep = list.map((_, n) =>
      interesting.slice(Math.max(0, n - CONTEXT), n + CONTEXT + 1).some(Boolean)
    );
    const out = [];
    let n = 0;
    while (n < list.length) {
      if (keep[n]) {
        out.push({ type: 'row', row: list[n] });
        n++;
      } else {
        const start = n;
        while (n < list.length && !keep[n]) n++;
        if (expandedGaps.has(start)) {
          list.slice(start, n).forEach((row) => out.push({ type: 'row', row }));
        } else {
          out.push({ type: 'gap', start, count: n - start });
        }
      }
    }
    return out;
  }

  function renderSplit(list) {
    const html = withCollapse(list).map((item) => {
      if (item.type === 'gap') {
        return `<div class="gap" data-start="${item.start}">⋯ ${item.count} unchanged line${item.count === 1 ? '' : 's'} — click to expand</div>`;
      }
      const r = item.row;
      const aCell = r.kind === 'ins'
        ? '<div class="cell empty"></div>'
        : `<div class="cell ${r.kind === 'eq' ? '' : 'minus'}"><span class="ln">${r.an || ''}</span><code>${r.aWords ? words(r.aWords) : esc(r.a)}</code></div>`;
      const bCell = r.kind === 'del'
        ? '<div class="cell empty"></div>'
        : `<div class="cell ${r.kind === 'eq' ? '' : 'plus'}"><span class="ln">${r.bn || ''}</span><code>${r.bWords ? words(r.bWords) : esc(r.b)}</code></div>`;
      return `<div class="line">${aCell}${bCell}</div>`;
    }).join('');
    return `<div class="split">${html}</div>`;
  }

  function renderUnified(list) {
    const html = withCollapse(list).map((item) => {
      if (item.type === 'gap') {
        return `<div class="gap" data-start="${item.start}">⋯ ${item.count} unchanged line${item.count === 1 ? '' : 's'} — click to expand</div>`;
      }
      const r = item.row;
      if (r.kind === 'eq') {
        return `<div class="uline"><span class="ln">${r.an}</span><span class="ln">${r.bn}</span><span class="sign"> </span><code>${esc(r.a)}</code></div>`;
      }
      const parts = [];
      if (r.kind === 'del' || r.kind === 'mod') {
        parts.push(`<div class="uline minus"><span class="ln">${r.an}</span><span class="ln"></span><span class="sign">-</span><code>${r.aWords ? words(r.aWords) : esc(r.a)}</code></div>`);
      }
      if (r.kind === 'ins' || r.kind === 'mod') {
        parts.push(`<div class="uline plus"><span class="ln"></span><span class="ln">${r.bn}</span><span class="sign">+</span><code>${r.bWords ? words(r.bWords) : esc(r.b)}</code></div>`);
      }
      return parts.join('');
    }).join('');
    return `<div class="unified">${html}</div>`;
  }

  function renderPatch(list) {
    return `<pre class="patch">${esc(toUnified(list, 'a/original.txt', 'b/changed.txt', 3))}</pre>`;
  }

  function run() {
    const result = diffLines($('left').value, $('right').value, {
      ignoreWhitespace: $('ws').checked,
      ignoreCase: $('case').checked,
    });
    rows = alignRows(result);
    const s = summarize(rows);

    $('summary').innerHTML =
      `<span class="stat add">+${s.added + s.changed}</span>` +
      `<span class="stat del">−${s.removed + s.changed}</span>` +
      `<span class="stat dim">${s.unchanged} unchanged</span>` +
      (s.added + s.removed + s.changed === 0 ? '<span class="stat same">identical</span>' : '');

    $('output').innerHTML = view === 'split' ? renderSplit(rows)
      : view === 'unified' ? renderUnified(rows)
      : renderPatch(rows);
  }

  $('output').addEventListener('click', (e) => {
    const gap = e.target.closest('[data-start]');
    if (!gap) return;
    expandedGaps.add(Number(gap.dataset.start));
    run();
  });

  document.querySelectorAll('.seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      view = btn.dataset.view;
      run();
    });
  });

  // Gap indices are positions in the current row list, so any edit invalidates them.
  const rerun = () => { expandedGaps.clear(); run(); };
  ['left', 'right'].forEach((id) => $(id).addEventListener('input', debounce(rerun, 200)));
  ['ws', 'case', 'collapse'].forEach((id) => $(id).addEventListener('change', rerun));

  $('swap').addEventListener('click', () => {
    const tmp = $('left').value;
    $('left').value = $('right').value;
    $('right').value = tmp;
    run();
  });

  $('sample').addEventListener('click', () => {
    $('left').value = SAMPLE_LEFT;
    $('right').value = SAMPLE_RIGHT;
    run();
  });

  $('toggle-inputs').addEventListener('click', (e) => {
    const hidden = $('inputs').classList.toggle('hidden');
    e.target.textContent = hidden ? 'Show editors' : 'Hide editors';
  });

  $('copy-patch').addEventListener('click', async (e) => {
    const patch = toUnified(rows, 'a/original.txt', 'b/changed.txt', 3);
    try {
      await navigator.clipboard.writeText(patch);
      e.target.textContent = 'Copied ✓';
      setTimeout(() => { e.target.textContent = 'Copy unified patch'; }, 1600);
    } catch {
      e.target.textContent = 'Clipboard blocked';
    }
  });

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  $('left').value = SAMPLE_LEFT;
  $('right').value = SAMPLE_RIGHT;
  run();
})();
