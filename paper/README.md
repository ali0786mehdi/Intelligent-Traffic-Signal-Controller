# Research Paper (IEEE Conference, two-column)

`research_paper.tex` is the IEEE two-column conference version of the paper.
The Markdown version with the same content is `../RESEARCH_PAPER.md`.

## How to compile

### Option A — Overleaf (easiest, recommended)
1. Go to overleaf.com → New Project → Blank Project (or "Upload Project").
2. Upload `research_paper.tex`.
3. Overleaf ships `IEEEtran.cls` built in — just click **Recompile**.
   (Menu → Compiler: pdfLaTeX.)

### Option B — Local TeX distribution
Requires TeX Live / MiKTeX (both include `IEEEtran.cls`):
```bash
pdflatex research_paper.tex
pdflatex research_paper.tex   # run twice to resolve references/labels
```
Output: `research_paper.pdf`.

## Notes
- ~6 pages in IEEE two-column format (9 sections, 6 tables, 5 embedded figures,
  1 algorithm block). Exact page count depends on the TeX engine's float
  placement; if it runs slightly long, move a figure or two to `[b]`/`[h]`
  placement or shrink with `width=0.9\columnwidth`.
- Figures are in `figures/` (copied from `../results/plots/`) and referenced via
  `\graphicspath{{figures/}}`.
- Uses standard packages (cite, amsmath, graphicx, booktabs, algorithm,
  algpseudocode, xcolor, url) — all bundled with TeX Live/MiKTeX and Overleaf.
- All six `\bibitem` entries match the `\cite{}` keys (validated).
- References are formatted to IEEE style but should be **verified** against the
  actual sources before submission.
- Fill in the author block (`[Your Department]`, etc.) at the top of the `.tex`.
- **Not compile-tested here** (no TeX engine available in this environment). It
  was validated structurally: balanced `\begin/\end` (30/30), all figure files
  present, all citations resolved. Do one Overleaf compile before submitting.
- **Originality:** the prose is written specifically for this project. Run it
  through your institution's plagiarism checker (e.g., Turnitin) before
  submission; verbatim overlap should be minimal since results, methodology, and
  discussion describe this specific implementation.

## Figures
All five result figures are **already embedded** in `research_paper.tex` and
live in `figures/`: `compare_avg_wait.png`, `compare_avg_queue.png`,
`compare_throughput.png`, `training_curves.png`, `hetero_ablation.png`.
If you regenerate results, refresh them with:
`cp ../results/plots/*.png figures/` (or the Windows `Copy-Item` equivalent).
