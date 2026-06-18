# Interface Design

Use this when Dave has selected a deepening candidate and interface shape
matters. The goal is to design more than once before committing a Seeds plan.

Use architecture vocabulary from [LANGUAGE.md](LANGUAGE.md) and dependency
categories from [DEEPENING.md](DEEPENING.md).

## 1. Frame the problem space

Before generating alternatives, write a short user-facing frame:

- what concept the deepened module represents;
- constraints every interface must satisfy;
- dependencies and their categories;
- likely seam placement;
- what sits behind the interface;
- which callers cross the seam;
- what tests must survive;
- one rough code sketch if it helps make constraints concrete.

This sketch is not the proposal. It is only a shared constraint model.

## 2. Produce multiple designs

Produce at least three materially different interface options when useful.

If subagents or orchestration are available, run them in parallel with
independent briefs. If not, design the alternatives directly and say that
subagents were unavailable.

Useful briefs:

1. **Minimal interface**: 1 to 3 entry points, maximum leverage per entry point.
2. **Flexible interface**: extension-friendly, handles varied callers.
3. **Caller-first interface**: common path is trivial.
4. **Ports-and-adapters interface**: for cross-seam dependencies or owned remote
   services.

Each design must include:

- interface shape, including types, parameters, invariants, ordering, and error
  modes;
- usage example showing caller code;
- what implementation details are hidden behind the seam;
- dependency and adapter strategy;
- test strategy through the interface;
- trade-offs in depth, locality, seam placement, and caller leverage.

## 3. Present and compare

Present designs sequentially so Dave can absorb each one. Then compare them
directly by:

- depth;
- locality;
- seam placement;
- adapter reality;
- test surface;
- migration cost;
- compatibility with ADRs and domain language.

Give a recommendation. If a hybrid is better than any single design, propose it
clearly.

## 4. Select with a checkpoint

When there are 2 to 4 viable options, use `ask_user` or `ask_user_question` if
available. Put the recommended option first. Include short trade-offs and the
artifact that will change. If the tool is unavailable, ask in normal chat.

Do not submit the Seeds plan until Dave approves the chosen interface and scope.

## 5. Persist the choice

After approval:

- record the chosen interface and rejected alternatives in the Seeds plan;
- update `CONTEXT.md` only for resolved domain terms;
- offer an ADR only for hard-to-reverse, surprising trade-offs;
- create Seeds child tasks only after the plan is submitted;
- record Mulch only after implementation and validation confirm reusable
  learning.
