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
- Uses only standard packages (cite, amsmath, graphicx, booktabs, xcolor, etc.)
  all bundled with TeX Live/MiKTeX and Overleaf.
- All six `\bibitem` entries match the `\cite{}` keys used in the text.
- References are placeholders formatted to IEEE style — **verify and complete
  each citation** against the actual sources before submission.
- Fill in the author block (`[Your Department]`, `[Your Institution]`,
  `[City, Country]`) at the top of the `.tex`.
- **Not compile-tested here** (no TeX engine was available in this environment);
  it was hand-validated for balanced environments and matching citations, but
  do a test compile on Overleaf before submitting.

## Adding figures (optional)
To embed the result charts, copy them next to the `.tex` and add, e.g.:
```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=\columnwidth]{compare_avg_wait.png}
  \caption{Average waiting time: Static vs Actuated vs D3QN.}
  \label{fig:wait}
\end{figure}
```
The charts are in `../results/plots/` (`compare_avg_wait.png`,
`training_curves.png`, `hetero_ablation.png`).
