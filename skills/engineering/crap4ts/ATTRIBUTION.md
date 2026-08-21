# Attribution

The CRAP metric was introduced as **Change Risk Analysis and Prediction** and
later reframed by crap4j as **Change Risk Anti-Patterns**. Alberto Savoia,
working with his AgitarLabs colleague Bob Evans, developed the formula
`CRAP(fn) = CC² × (1 − coverage)³ + CC` circa 2007; see Savoia's Artima articles
"Pardon My French, But This Code Is C.R.A.P." and the crap4j FAQ.

This skill is an **independent implementation** of that formula for
JavaScript/TypeScript, modeled on the workflow and user experience of Robert
C. Martin's later per-language ports:

- [unclebob/crap4clj](https://github.com/unclebob/crap4clj) (Clojure) — the
  recommended workflow loop and per-form coverage mapping.
- [unclebob/crap4go](https://github.com/unclebob/crap4go) (Go) — the
  worst-first report format, path-fragment filtering, and path-suffix
  coverage fallback.
- [unclebob/crap4java](https://github.com/unclebob/crap4java) (Java) — the
  `--changed` scope, file/directory arguments, and threshold exit-code gate.

No code was copied from those repositories. The conceptual grounding is
Robert C. Martin, *Clean Code: A Handbook of Agile Software Craftsmanship*
(Prentice Hall, 2008), particularly chapters 3 (Functions), 9 (Unit Tests),
12 (Emergent Design), 14 (Successive Refinement), and 17 (Smells and Heuristics).
