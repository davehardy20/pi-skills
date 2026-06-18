# HTML Report Format

The architecture review report is exploratory. Write it as a single HTML file in
the OS temp directory, never in the target repo. It helps Dave choose a
candidate. Seeds becomes canonical only after a candidate is selected.

Use architecture language from [LANGUAGE.md](LANGUAGE.md) and dependency
categories from [DEEPENING.md](DEEPENING.md).

## Location

Resolve the temp directory in this order:

1. `$TMPDIR` when present;
2. `/tmp` on Unix-like systems;
3. `%TEMP%` on Windows.

Use filename pattern:

```text
architecture-review-<timestamp>.html
```

Open it when supported:

- macOS: `open <path>`
- Linux: `xdg-open <path>`
- Windows: `start <path>`

Tell Dave the absolute path.

## Scaffold

Tailwind and Mermaid may come from CDNs. The report must remain static except
for Mermaid rendering.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Include repo name, date, and a compact legend:

- solid box = module;
- dashed line = seam;
- red arrow = leakage;
- thick dark box = deep module.

Skip long introductions. Go straight to candidates.

## Candidate card

Each candidate is an `<article>` with sparse prose and strong visuals.

Include:

- **Title**: short, names the deepening.
- **Badge row**: recommendation strength plus dependency category.
- **Files**: monospaced list of involved files and modules.
- **Before / After diagram**: side-by-side visualisation.
- **Problem**: one sentence.
- **Solution**: one sentence.
- **Wins**: short bullets using locality, leverage, and test-surface language.
- **ADR callout**: amber warning only when real friction justifies reopening an
  ADR.

Recommendation strength must be one of:

- `Strong`
- `Worth exploring`
- `Speculative`

Dependency category should be one of:

- `in-process`
- `local-substitutable`
- `ports & adapters`
- `mock`

Do not propose concrete interfaces in the report.

## Diagram patterns

Use Mermaid when the shape is graph-like. Use hand-built divs or inline SVG when
the visual needs editorial weight.

### Mermaid graph

Good for dependency and call-flow mess.

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leaks.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Hand-built boxes and arrows

Good when Mermaid layout fights the point. Use modules as bordered divs and
arrows as inline SVG. Use this for a deep module containing faded internal
implementation details.

### Cross-section

Good for layered shallowness. Before: many thin bands. After: one thick band
labelled with the consolidated responsibility.

### Mass diagram

Good for showing an interface nearly as large as its implementation. Before:
interface rectangle almost as tall as implementation. After: small interface,
large implementation.

### Call-graph collapse

Good for showing many caller-visible steps becoming internal implementation
details. Before: nested or branching calls. After: one deep module with faded
internals.

## Style

- Editorial, not dashboard.
- Generous whitespace.
- One accent colour plus red for leakage and amber for warnings.
- Keep diagrams about 320px tall so before/after fits side by side.
- Use concise labels in diagrams.
- No app code or report interactivity beyond Mermaid rendering.

## Top recommendation

End with one larger card:

- candidate name;
- one sentence on why it should go first;
- link to the candidate card.

Then ask Dave which candidate to explore. Do not create Seeds tasks yet.
