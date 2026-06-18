# Architecture Language

Use this vocabulary in reports, Seeds issues, Seeds plans, ADRs, and
implementation review notes. Consistent language is the point. Do not drift into
nearby words because they feel natural.

## Terms

**Module**
Anything with an interface and an implementation. Scale-agnostic: a function,
class, package, slice, or tier-spanning capability can be a module.
_Avoid_: unit, component, service.

**Interface**
Everything a caller must know to use a module correctly. Includes types,
parameters, invariants, ordering constraints, error modes, required
configuration, performance expectations, and observable side effects. Not just
the type signature.
_Avoid_: API, signature.

**Implementation**
The code inside a module. Use **adapter** when the seam role is the topic; use
implementation otherwise.

**Depth**
Leverage at the interface: the amount of behaviour a caller or test can exercise
per unit of interface they must understand. A module is **deep** when a lot of
behaviour sits behind a small interface. A module is **shallow** when the
interface is nearly as complex as the implementation.

**Seam**
Where an interface lives; a place where behaviour can be altered without editing
that place. Choosing seam placement is a design decision distinct from deciding
what sits behind it.
_Avoid_: boundary.

**Adapter**
A concrete thing that satisfies an interface at a seam. Describes role, not size
or substance.

**Leverage**
What callers get from depth: more capability per unit of interface they learn.

**Locality**
What maintainers get from depth: change, bugs, knowledge, and verification
concentrate in one place instead of spreading across callers.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep
  module can contain many internal helpers. They should not become part of the
  external interface unless callers need them.
- **The deletion test.** Imagine deleting the module. If complexity vanishes,
  the module was a pass-through. If complexity reappears across callers, the
  module was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam.
  If tests need to reach past the interface, the module probably has the wrong
  shape.
- **One adapter means a hypothetical seam. Two adapters mean a real seam.** Do
  not introduce a seam unless something actually varies across it.
- **Internal seams are allowed.** A deep module can have private seams used by
  its implementation or tests. Do not expose them through the external interface
  just because tests use them.
- **Depth is about leverage, not line-count ratios.** Do not reward padded
  implementation size.

## Relationships

- A **module** has one external **interface**.
- **Depth** is measured against that interface.
- A **seam** is where the module's interface lives.
- An **adapter** sits at a seam and satisfies the interface.
- **Depth** creates **leverage** for callers and **locality** for maintainers.

## Rejected framings

- Do not call modules components, services, or units when discussing architecture
  depth.
- Do not use interface to mean only a TypeScript `interface`, public method
  list, or type signature.
- Do not call a seam a boundary; that collides with bounded-context language.
- Do not treat a pass-through module as deep because it has many files behind it.
- Do not create a seam for test mocks alone unless there is a justified second
  adapter.
