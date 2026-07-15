# DiffDeck

Side-by-side text diffing in the browser, with word-level highlighting and unified-patch export. No upload, no account, no build step.

**Live:** https://studiofelite-sys.github.io/diffdeck/

## Views

- **Split** — two columns, aligned, with changed words highlighted inside changed lines.
- **Unified** — one column with `+`/`-` markers and both sets of line numbers.
- **Patch** — a real unified diff you can paste into `git apply`.

## How the diff works

`js/diff.js` is a dependency-free implementation in three layers:

**Line pass.** A longest-common-subsequence table walk. Before building the table it trims the common prefix and suffix, because in a realistic diff the interesting part is a small middle inside two mostly-identical files — that trim is the difference between an `O(n·m)` table over the whole file and one over the twenty lines that actually changed. If the remaining middle would still exceed ~4M cells, it degrades to treating the region as a wholesale replacement instead of allocating a table it can't afford.

**Alignment pass.** Runs of deletions immediately followed by insertions get zipped into paired `mod` rows, so a modified line shows up opposite its replacement rather than as an unrelated delete floating above an unrelated add.

**Word pass.** Each paired row is re-diffed at word granularity using the same LCS routine over a tokenizer that keeps separators, so the pieces round-trip exactly. This is why changing `5000` to `8000` highlights four characters and not the whole line.

## Options

| Option | Effect |
| --- | --- |
| ignore whitespace | Collapses runs of whitespace and trims before comparing |
| ignore case | Case-insensitive line matching |
| collapse unchanged | Hides runs outside 3 lines of context; click a marker to expand it |

Swap sides with one button, hide the editors to give the diff the full window, and copy the unified patch to the clipboard.

## Running locally

```bash
git clone https://github.com/studiofelite-sys/diffdeck.git
cd diffdeck
python3 -m http.server 8000
```

## License

MIT — see [LICENSE](LICENSE).
