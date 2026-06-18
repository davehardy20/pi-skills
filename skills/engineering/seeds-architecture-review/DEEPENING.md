# Deepening

Use this when assessing a candidate from the HTML report or shaping a Seeds
plan. It assumes the vocabulary in [LANGUAGE.md](LANGUAGE.md): module,
interface, implementation, seam, adapter, depth, leverage, and locality.

## Dependency categories

Classify candidate dependencies before proposing a seam. Record the category in
the report and in the candidate-specific Seeds epic or plan when it affects
testing.

### 1. In-process

Pure computation, in-memory state, or local code with no I/O. Usually safe to
deepen by merging shallow modules and testing through the new interface
directly. No external adapter is needed.

### 2. Local-substitutable

Dependencies with local test stand-ins, such as an in-memory filesystem or
embedded database. Deepen if the stand-in can run in the test suite. Keep the
seam internal unless production and test genuinely need different adapters at
the external interface.

### 3. Remote but owned: ports and adapters

Owned services across a network seam, such as internal HTTP, gRPC, queue, or
worker calls. Define a port at the seam. The deep module owns the logic.
Transport-specific code becomes an adapter. Tests use an in-memory adapter.
Production uses the transport adapter.

Recommended wording:

```text
Define a port at the seam. Use an HTTP adapter for production and an in-memory
adapter for tests, so the logic sits in one deep module even though execution
crosses a network.
```

### 4. True external: mock

Third-party systems the team does not control. The deep module takes the
external dependency through an injected port. Tests provide a mock or fake
adapter. Production provides the real external adapter. Keep provider-specific
quirks behind the adapter.

## Seam discipline

- One adapter means a hypothetical seam. Two adapters mean a real seam.
- Do not add a port because an implementation detail is awkward to test.
- Prefer internal seams for implementation variation that callers do not need to
  know about.
- Expose only the external interface that creates leverage for callers.
- If seam placement is unclear, compare alternatives before submitting the Seeds
  plan.

## Testing strategy: replace, do not layer

- Add characterization tests before changing risky behaviour.
- New tests should cross the deepened module's interface.
- Tests assert observable outcomes, not internal state.
- Existing shallow-module unit tests become waste once equivalent deep-interface
  coverage exists; delete or rewrite them.
- Do not preserve tests that force callers to know implementation details.
- Seeds child tasks should make test migration explicit: characterize, deepen,
  migrate callers, delete obsolete shallow tests.

## When not to deepen

Do not recommend deepening when:

- deletion would remove complexity rather than concentrate it;
- the module has only one caller and no repeated complexity;
- the seam has one adapter and no real variation;
- the change would contradict a valid ADR without enough friction to reopen it;
- the candidate needs unresolved domain language before seam placement can be
  judged.
