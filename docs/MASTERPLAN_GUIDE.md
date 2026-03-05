# BizAssist Masterplan Guide

**Status:** Canonical (must be followed)  
**Scope:** BizAssist_mobile + BizAssist_api  
**Audience:** You (lead architect), implementation engineers, and future contributors

This document is the **north star** for how BizAssist is designed, built, and shipped. If code conflicts with this guide, the code is wrong and must be refactored.

---

## 0. CODEX Agent Governance (Patch-Only Mode) — Locked

1. **Mission:** implement requested change exactly as specified, with minimal diffs, no architectural drift, and zero TypeScript errors.
2. **Token governance:** return patch-style unified diffs only; do not return full files; do not repeat unchanged code; keep explanations concise and technical.
3. **Global constraints:** enforce tablet-first governance, Back vs Exit Navigation Law, Busy/Loading Overlay governance, UDQI precision rules, Money 2-decimal input enforcement, and archive-only lifecycle governance where applicable.
4. **Execution framework:**

- Step 1: repo scan for relevant components/modules/navigation/API/state/cross-module impacts.
- Step 2: implement minimal diffs only, preserve existing patterns and business logic.

5. **No drift rules:** no unrelated edits, no naming drift, no new abstractions unless explicitly requested.
6. **Required delivery format:**

- Files Updated (path + one-line reason)
- Unified patch diffs only

## 0.1 BizAssist SaaS Engineering Governance Framework (Locked)

BizAssist governance is enforced as a canonical **6-layer architecture framework**:

1. Product UI / UX System Governance
2. Backend Architecture Governance
3. Data Model Governance
4. Platform Integration Governance
5. Mobile Engineering Governance
6. Repository / File Structure Governance

Implementation and review work must map to these layers and must not introduce parallel governance systems.

Framework objectives:

- UI consistency
- stable APIs
- predictable mobile state behavior
- maintainable backend services
- scalable repository architecture

Audit lock:

- governance coverage across these six layers is complete
- no architectural governance layer is currently missing

## 0.2 BizAssist Architecture Lawbook (Locked)

Purpose:

- The Architecture Lawbook defines non-negotiable engineering rules that protect long-term platform stability, scalability, and maintainability.
- Violations must be corrected before acceptance.

### Law 1 — Feature Ownership

- Every feature must have a single owning module for business logic, API endpoints, and mutations.
- Modules may consume other modules but must never override ownership.

### Law 2 — Feature-First Architecture

- Backend and mobile must use feature-first module structures:
  - `api/src/modules/<feature>/`
  - `mobile/src/modules/<feature>/`
- Layer-first architecture as primary organization is prohibited.

### Law 3 — Controllers Must Remain Thin

- Controllers only handle HTTP input/output, validation handoff, and service invocation.
- Business logic must live in services.

### Law 4 — Repositories Are Database-Only

- Repositories perform database access only.
- No business logic, validation orchestration, or workflow orchestration in repositories.

### Law 5 — APIs Must Be Backward Compatible

- API contracts must remain stable for deployed clients.
- Breaking changes require explicit versioning.
- Safe evolution includes additive optional fields and careful enum extension.

### Law 6 — Server State Belongs to React Query

- Mobile server state must be managed through TanStack React Query.
- React Query owns caching, synchronization, and invalidation.

### Law 7 — UI State Must Remain Local

- Temporary UI state remains local to screens where practical.
- Global state must stay minimal and intentional.

### Law 8 — Continuous Scroll Form Architecture

- Forms must use continuous scroll with independent section surfaces.
- A single large wrapper card around full-form content is prohibited.

### Law 9 — One Primary Action per Screen Region

- Each actionable region has one clear primary CTA.
- Secondary CTAs are contextual and visually subordinate.

### Law 10 — Domain Entities Must Have Stable Identity

- Entities require stable primary keys.
- Business identifiers (for example SKU/barcode) must remain separate mutable fields.

### Law 11 — Schema Changes Must Be Safe

- Prefer additive schema evolution.
- Deprecate before removal.
- Avoid destructive migrations in production paths.

### Law 12 — Lifecycle Over Deletion

- Critical entities should use lifecycle states (for example `ACTIVE`, `ARCHIVED`) rather than hard deletion.

### Law 13 — API Endpoints Must Reflect Domain Ownership

- Endpoint namespaces must map to owning domain responsibilities.
- Mixed-responsibility endpoints are prohibited.

### Law 14 — Feature Modules Must Remain Decoupled

- Minimize cross-feature coupling.
- Consume through shared utilities/contracts, not internal cross-module imports.

### Law 15 — Repository Structure Must Remain Predictable

- Backend modules should maintain canonical structure:
  - controller
  - service
  - repository
  - routes
  - validators
  - types
- Mobile modules must group screens/components/api clients by feature.

### Law 16 — Errors Must Be Structured and Understandable

- Errors must return predictable structures with code and human-readable message.
- Internal system details must not leak to clients.

### Law 17 — Mutations Must Trigger Cache Updates

- Writes must invalidate or update relevant caches deliberately and predictably.

### Law 18 — Shared Components Must Remain Generic

- Shared UI components must remain feature-agnostic.
- Feature-specific components stay in feature modules.

### Law 19 — Performance Must Be Preserved by Design

- Architecture decisions must prioritize performance by default:
  - efficient caching
  - indexed query paths
  - controlled payloads

### Law 20 — Architecture Discipline Is Mandatory

- Architecture rules are binding engineering constraints, not suggestions.
- Non-compliant designs must be refactored before implementation/merge.

Final principle:

- Architecture discipline is the foundation of long-term BizAssist product stability.

## 0.3 BizAssist Engineering Playbook (Locked)

Purpose:

- The Engineering Playbook is the operational development manual for day-to-day implementation, debugging, review, and delivery.
- The Lawbook defines non-negotiable rules; the Playbook defines practical execution workflow.

### Standard Engineering Workflow

All feature work must follow:

- Idea
- Discovery
- Architecture Design
- Masterplan Approval
- Implementation
- Review
- Merge

No feature may bypass this workflow.

### Discovery Phase Requirements

Before implementation, discovery must produce:

- user flow
- affected modules
- data model changes
- mobile screen impact

Discovery must identify:

- feature intent and UX flow
- ownership boundaries
- architecture risks

### Masterplan Approval Gate

After discovery and before coding:

- validate architecture compatibility
- validate UI consistency
- validate navigation compliance
- validate module ownership

Conflicting designs must be redesigned before implementation.

### Implementation Phase Rules

Implementation must:

- follow feature ownership
- preserve modular architecture
- avoid unnecessary abstractions
- respect API contracts
- avoid architectural drift

### Pull Request Review Checklist (Mandatory)

Architecture:

- Is ownership/module placement correct?

Business logic:

- Is workflow logic in services (not controllers)?

Database:

- Are schema changes safe and non-destructive?

API:

- Are contracts backward compatible?

Mobile state:

- Does server-state handling follow React Query governance?

UI:

- Does the screen follow section-surface architecture rules?

Repository:

- Does file structure remain feature-first and predictable?

Performance:

- Are unnecessary API calls and expensive query paths avoided?

PRs failing these checks must be corrected before merge.

### Capability Alignment CI Gate (Mandatory)

When a PR changes feature/flow documentation, the CI workflow `Capability Alignment Check` must pass.

Scope enforced by CI:

- `docs/features/*.md`
- `docs/features/*MASTERPLAN*.md`
- `docs/*FLOW*.md`
- `docs/*QA_CHECKLIST*.md`

Required fields in scoped docs:

- `Capability:`
- `Sub Capability:`
- `Owner Surface:`
- `Domain Entities:`
- `System Invariants:`
- `Reference:` with at least one non-empty backticked doc link bullet

Implementation references:

- `.github/workflows/capability-alignment-check.yml`
- `scripts/validate-capability-alignment.sh`
- `docs/APP_FEATURE_FLOW_CAPABILITY_ALIGNMENT.md`

### Debugging Workflow

1. Reproduce consistently.
2. Identify owning layer:
   - UI
   - state
   - API
   - service
   - database
3. Trace end-to-end data flow (UI to DB).
4. Fix root cause; avoid symptom-only patches.

### Bug Fix Principle

- Prioritize root-cause resolution.
- Temporary workarounds are exceptional and must be followed by scheduled permanent fixes.

### Refactoring Rules

Allowed:

- simplify logic
- remove duplication
- improve naming

Constraint:

- no behavior change unless explicitly intended and reviewed.

### Code Deletion Principle

- Remove confirmed dead code.
- Before deletion:
  - verify unused status
  - verify no dependent feature paths remain

### Migration Safety Checklist

For every migration:

- verify safety
- avoid destructive changes
- test in development/staging prior to production

Never deploy migrations that risk production data integrity.

### API Change Procedure

Before API modification:

- evaluate deployed mobile compatibility impact

Safe:

- optional field additions
- new endpoints

Unsafe:

- field removal
- field rename
- response contract changes

Breaking changes require API versioning.

### State Management Guidelines

- Server data must be managed via React Query.
- Queries must use stable keys.
- Mutations must invalidate/update relevant caches.
- Avoid manual non-React-Query server fetch/write patterns without explicit exception.

### Form Development Rules

- Keep form state local until explicit submit.
- Validate before mutation.
- Use continuous-scroll section architecture.
- Normalize vertical rhythm across sibling forms (create/edit) using one spacing scale per flow.
- For inventory/service form surfaces, treat `12` as the default vertical spacing unit for section content gaps, stacked field gaps, and action-group spacing unless a documented exception is required.
- Avoid ad-hoc spacer views and negative/one-off margin nudges for vertical layout; prefer governed style tokens in the screen StyleSheet.

### Performance Review Rules

Every feature must evaluate:

- render efficiency
- API request volume
- query/index performance for frequent access paths

### Security Principle

Security is mandatory in implementation:

- validate all inputs
- protect authenticated endpoints
- avoid leaking internal system details

### Documentation Standard

Significant features must document:

- feature description
- API endpoints
- data model changes

### Final Principle

The Engineering Playbook defines how BizAssist is built every day.
Adherence is mandatory to keep the platform maintainable, scalable, and predictable.

## 0.4 Architecture Decision Records (ADR) System (Locked)

Purpose:

- ADR is the official institutional memory for architectural decisions in BizAssist.
- Architectural decisions must never rely on tribal knowledge.
- If an engineer asks, “Why are we doing this?”, the answer must be “See ADR-XXXX.”

### ADR Scope

Create ADRs for strategic decisions affecting:

- system architecture
- data model architecture
- product architecture
- infrastructure architecture
- cross-system governance
- AI architecture

Do not create ADRs for minor implementation tweaks (for example spacing-only UI changes, tiny refactors, or small non-strategic code edits).

### ADR Storage and Format

- Canonical directory:
  - `docs/architecture/adr/`
- ADR files are Markdown and immutable records:
  - `ADR-0001-title.md`
  - `ADR-0002-title.md`
  - `ADR-0003-title.md`

### Numbering and Immutability Rules

- Sequential numbering, never reused.
- ADR records are never deleted.
- Status may evolve; record identity stays permanent.

### Status Lifecycle

Allowed statuses:

- Proposed
- Accepted
- Deprecated
- Superseded
- Rejected

### Mandatory ADR Template

All ADRs must follow the canonical template in:

- `docs/architecture/adr/TEMPLATE.md`

### ADR Ownership

Ownership by decision scope:

- System Architecture:
  - owner: System Architect / Founder
- Product Architecture:
  - owner: Product Architecture Authority
- Infrastructure Architecture:
  - owner: Platform / DevOps

### ADR Review Workflow

Problem Identified
→ Architecture Discussion
→ ADR Drafted
→ Architecture Review
→ ADR Accepted

Accepted ADRs become enforceable architecture law.

### ADR Change Governance

To change architecture decisions:

1. create a new ADR
2. reference the prior ADR
3. mark prior ADR status as `Superseded`

Historical ADRs remain preserved.

### Canonical ADR Set

Current canonical records:

- ADR-0001 Modular Monolith Architecture
- ADR-0002 Feature-First Module Structure
- ADR-0003 UDQI Quantity Model
- ADR-0004 Append-Only Inventory Ledger
- ADR-0005 Archive-Only Lifecycle
- ADR-0006 Tablet-First Design
- ADR-0007 POS Workspace Model
- ADR-0008 Inventory-First Strategy
- ADR-0009 Render Hosting
- ADR-0010 Supabase Storage
- ADR-0011 AWS SES Email
- ADR-0012 AI Assistive Model
- ADR-0013 AI Excluded From Transactions
- ADR-0014 No Modal / Drawer UI Model
- ADR-0015 Navigation Law (Back vs Exit)
- ADR-0016 Global Busy Overlay

## 0.5 Technical Standards Manual (Locked)

Purpose:

- The Technical Standards Manual defines implementation standards for day-to-day engineering across BizAssist.
- It operationalizes architecture discipline through enforceable coding, structure, API, data, performance, and review rules.

Canonical source:

- `docs/TECHNICAL_STANDARDS_MANUAL.md`

Coverage includes:

- code style standards
- project structure standards
- API design standards
- database standards
- data integrity standards
- mobile application standards
- navigation standards
- performance standards
- security standards
- media pipeline standards
- logging standards
- testing standards
- error handling standards
- documentation standards
- governance enforcement standards

Enforcement:

- PRs must satisfy the Technical Standards Manual before merge.
- Non-compliant changes must be corrected or rejected.

## 0.6 Domain Model Bible (Locked)

Purpose:

- The Domain Model Bible defines BizAssist canonical business entities and non-negotiable invariants.
- It is the domain truth source for API behavior, mobile behavior, schema design, reporting, analytics, and AI read paths.

Canonical source:

- `docs/DOMAIN_MODEL_BIBLE.md`

Locked principles:

- inventory-first architecture
- append-only inventory ledger
- UDQI fixed-point quantity system (`Unit.precisionScale`)
- archive-only lifecycle governance

Canonical core entities include:

- User
- Business
- StaffMembership
- Product
- Unit
- Category
- ModifierSet
- ModifierOption
- Sale
- SaleLineItem
- Payment
- InventoryMovement

Invariant enforcement:

- inventory totals derive from immutable movement history
- sale line pricing is snapshotted at finalization and historically immutable
- modifier effects are price-only and never inventory quantity mutators
- completed sales are immutable and preserve linked inventory movements

Implementation rule:

- if implementation contradicts the Domain Model Bible, implementation must be refactored to conform.

## 0.7 System Invariants & Guardrails (Locked)

Purpose:

- System Invariants & Guardrails define non-negotiable safety rules that protect financial correctness, inventory integrity, authorization safety, and historical data trust.
- Invariant violations must fail fast rather than allow corrupted state.

Canonical source:

- `docs/SYSTEM_INVARIANTS_GUARDRAILS.md`

Locked invariant domains:

- inventory invariants (append-only movement-derived stock)
- quantity invariants (UDQI precision and fixed-point storage)
- financial invariants (sale totals and payment reconciliation)
- pricing invariants (historical unitPrice immutability)
- modifier invariants (price-only effects)
- sale finality invariants (immutable completed sales)
- lifecycle invariants (archive-only business entities)
- authorization invariants (auth + activeBusiness + membership)
- media invariants (signed upload pipeline + deterministic paths)

Guardrail enforcement:

- critical rules must be enforced across API validation, service checks, and database constraints
- client validation alone is insufficient

Observability:

- all invariant violations must be logged with violation type, entity, user context, and correlationId

Enforcement rule:

- if an operation would violate an invariant, the operation must be rejected.

## 0.8 Feature Lifecycle Governance (Locked)

Purpose:

- Feature Lifecycle Governance defines the mandatory stage-gate process from idea through release and iteration.
- It ensures feature work is architecture-aligned, domain-safe, and operationally controlled.

Canonical source:

- `docs/FEATURE_LIFECYCLE_GOVERNANCE.md`

Locked lifecycle:

- Idea
- Discovery
- Decision
- Feature Ticket
- Implementation
- Release
- Iteration

Mandatory rule:

- no feature may skip lifecycle stages.

Decision governance:

- outcomes are `Approved`, `Rejected`, or `Deferred`
- architecture-changing features require ADR coverage before implementation

Ticket governance:

- approved features must include context anchor, feature idea, mode, ownership boundaries, technical constraints, acceptance criteria, and regression targets

Implementation governance:

- implementation must pass Architecture Lawbook, ADR, Domain Model Bible, System Invariants, and Technical Standards alignment checks

Release governance:

- release requires regression completion, invariant verification, and integration validation

Escalation/rollback:

- behavior-changing features require architecture review
- releases must be reversible (disable or rollback path)

## 0.9 Product Capability Map (Locked)

Purpose:

- The Product Capability Map defines what BizAssist can do, where each capability belongs, and who owns it.
- It is the canonical ownership map for module boundaries, screen ownership, API ownership, and data ownership.

Canonical source:

- `docs/PRODUCT_CAPABILITY_MAP.md`

Locked output model:

- Level 1 -> Level 2 -> Level 3 capability map (no deeper than Level 3)
- each Level 3 capability declares:
  - owner surface
  - mobile ownership
  - API ownership
  - DB ownership
  - entities involved
  - invariants impacted
  - exclusions/notes

Locked strategy alignment:

- inventory-first architecture
- tablet-first UX
- append-only inventory ledger
- UDQI quantity invariants
- archive-only lifecycle
- tabs as workspace selectors
- no drawers/modals/dropdowns as primary operational patterns
- AI assistive-only (never transactional authority)

Ownership law:

- Settings owns configuration lifecycle capabilities (categories, units, discounts, modifiers, policy placeholders)
- Inventory workspace owns item/service lifecycle and stock movement operations
- POS workspace owns cart/checkout/sales finalization and related inventory movement integration
- Home workspace is entry and quick-actions only (no deep management ownership)

Implementation rule:

- no feature may enter implementation unless assigned to a capability in the Product Capability Map.

## 0.10 Capability to Module to Workspace Mapping (Locked)

Purpose:

- This mapping defines structural placement for each feature across capability ownership, backend module ownership, mobile workspace exposure, and domain entity boundaries.
- It prevents duplication, overlap, and architectural drift.

Canonical source:

- `docs/CAPABILITY_MODULE_WORKSPACE_MAPPING.md`

Locked output schema:

- Capability
- Sub Capability
- Backend Module
- Mobile Workspace
- Primary Screens
- Domain Entities
- System Invariants

Locked workspaces:

- Home
- Inventory
- POS
- Settings

Locked rule:

- tabs are workspace selectors, not screen navigators.

Implementation gate:

- every feature must map capability, module, workspace, entities, and invariants before implementation.
- multi-module features must declare one primary owner module.

Safety constraints:

- no new module creation without architecture review
- no duplicated domain logic across modules
- no UI features outside defined workspaces

## 0.11 UI Padding Axis Terminology (Locked)

Purpose:

- This terminology lock standardizes spacing language used in UI implementation requests and reviews.

Locked mapping:

- `x padding` means horizontal padding (x-axis).
- `y padding` means vertical padding (y-axis).

Enforcement:

- Unless explicitly overridden in the request, all UI tasks must interpret x/y padding terms using this mapping.

## 1. Non‑Negotiable Product Principles

Quick index:

- See **1.13 Bottom Sheet vs Modal Selection Governance (Locked)** for canonical pattern selection criteria.

1. **Correctness over cleverness.** Inventory and POS must be deterministic, auditable, and replay‑safe.
2. **Offline‑safe writes where applicable.** Inventory writes must be idempotent and transactionally safe.
3. **Tablet-first layouts, not tablet-only interactions.** Tablets get persistent spatial UI (two‑pane), not hidden controls.
4. **No dropdowns, no drawers** in operational flows (Inventory/POS). Use drill‑in screens and full‑screen pickers.
5. **Hard screen transition** for navigation stability. Critical flows use deterministic `replace()`/controlled back behavior.
6. **Double‑tap prevention is mandatory.** Any action that navigates or writes must be guarded (disabled/busy).
7. **AI is optional and assistive-only.** AI can suggest; deterministic systems must remain authoritative.
8. **Cognitive-Emotional UX governance is mandatory.** App and website flows must pass Halo Effect, Cognitive Fluency, and Peak-End checks before release.

### 1.1 Cognitive-Emotional UX Governance (Locked)

All new or modified UX for app and website must follow:

1. **Halo Effect:** first viewport clarity, premium visual polish, and strong perceived performance.
2. **Cognitive Load + Cognitive Fluency:** one dominant job per screen, reduced decisions, familiar patterns, clear copy.
3. **Micro-Interactions + Peak-End Rule:** immediate feedback for each action, intentional value moments, and clear end-state closure.

Implementation details and release gates are canonical in `docs/COGNITIVE_EMOTIONAL_UX_MASTERPLAN.md`.

### 1.2 Post-Action Navigation Flow Governance (Locked)

Canonical term: **Post-Action Navigation Flow**.

This governs screen redirection after completion actions including Save, Archive, Restore, and equivalent write/lifecycle actions.

Rules:

1. **Deterministic closure only.** Use controlled navigation outcomes (`replace()` and governed back behavior) for stable end states.
2. **No ambiguous destinations.** Each action must resolve to one intended screen based on ownership context (operational vs management surface).
3. **Safety before transition.** Write/navigation actions must be double-tap safe and Busy/Loading Overlay governed.
4. **Clear completion signal.** Successful transitions must provide explicit closure feedback (toast/snackbar or equivalent pattern).
5. **Error path stays local.** Failed actions must not redirect away from the current context; preserve correction flow in-place.

### 1.3 Process Form and Lifecycle UX Governance (Locked)

1. **Form draft persistence is required** for multi-field process forms (also called draft state persistence). In-progress form input must survive transient navigation interruptions until explicit save/discard.
2. **Keyboard governance is required** on process forms with text input:

- Use keyboard avoidance behavior.
- Tapping outside inputs must dismiss keyboard.

3. **Lifecycle process separation is required.** Archive and Restore must be handled on dedicated process screens (not inline in detail/edit cards).
4. **Count formatting governance.** Compact numeric counts must use business-locale formatting utilities (not device-locale defaults or ad-hoc formatting).

### 1.4 Inventory + Settings Feature Flow Parity (Locked)

1. **Parity is mandatory.** Any approved feature flow update must be implemented in both **Inventory** and **Settings** when that flow exists in both contexts.
2. **Scope of parity.** Implementation parity includes behavior, navigation closure, lifecycle actions, and core UX structure.
3. **Release gate.** Work is not complete until both Inventory and Settings paths are updated and validated within the same implementation cycle.

### 1.5 Count Unit Naming Governance (Locked)

1. **Canonical COUNT display name is `Per Piece`.**
2. **Canonical COUNT abbreviations are `pc` (singular) and `pcs` (plural).**
3. **UI normalization is mandatory:** never display `ea`/`each` to users in quantity subtitles, product/service rows, or POS-facing labels.
4. **Internal compatibility is allowed:** `ea` may remain as internal/catalog identifiers, but all user-facing presentation must normalize to `pc/pcs`.

### 1.6 Purpose-Aligned Character Limit Governance (Locked)

1. Canonical policy term is **Purpose-Aligned Character Limit**.
2. Canonical implementation term is **Field Character Budget**.
3. Budgets must be centralized in shared limits (`FIELD_LIMITS` / shared `fieldLimits`) and treated as source of truth.
4. Budgets must be based on field purpose (e.g., label/name, description, search query, money input, identifiers) and not ad-hoc per-screen values.
5. All new/modified text inputs must enforce the same budget across UI input constraints and API validation.

### 1.7 Lifecycle Eligibility Gating (Locked)

1. Canonical product concept is **Lifecycle Eligibility Gating**.
2. Canonical UI/action pattern is **Eligibility-Gated Destructive Action**.
3. Hard delete may be offered only when the entity is provably **unreferenced and unused**:
   - no current attachments/dependencies
   - no historical operational usage
   - no active draft/template/workflow references that the product treats as meaningful dependencies
4. If the entity is not eligible for hard delete, the destructive action must fall back to the reversible lifecycle action (typically **Archive**).
5. The backend must be the source of truth for eligibility. UI must not infer hard-delete safety from visible counts alone; prefer explicit capability fields such as `canHardDelete` and a blocking reason.
6. Copy must remain explicit:
   - **Delete** = permanent, non-restorable
   - **Archive** = reversible, restorable
7. This governance does **not** override archive-only entities locked under ledger-referenced configuration governance. If an entity is archive-only by policy, hard delete remains disallowed even when currently unreferenced.

### 1.8 BAINeutralCheckbox Design Governance (Locked)

1. `BAINeutralCheckbox` is the canonical neutral checkbox component for BizAssist.
2. Visual state lock:
   - unchecked = outline only
   - checked = solid filled
   - square form with softened corners
   - bold check glyph
3. Contrast lock:
   - light mode uses dark monochrome treatment
   - dark mode uses light monochrome treatment
4. Reuse rule:
   - feature screens must consume `BAINeutralCheckbox` for neutral checkbox selection UI
   - do not create per-screen checkbox variants unless a new canonical checkbox pattern is explicitly approved
5. This lock applies to management and attach-selection flows unless a feature requires a different semantic control (for example radio or switch).

### 1.9 Flicker-Free Initial Screen Transition Governance (Locked)

1. Canonical fix pattern name is **Flicker-Free Initial Screen Transition**.
2. First-open transitions must avoid any layout jump caused by delayed safe-area resolution, cold-query loading branch swaps, or header remount mismatch.
3. Safe-area rule:
   - `SafeAreaProvider` must be seeded with `initialWindowMetrics`
   - header surfaces that depend on top inset must not render below the initial safe-area baseline on first frame
4. Header rule:
   - do not stack an in-screen header on top of a stack-managed header as a transition workaround
   - keep one stable header ownership strategy per route unless the navigation stack itself is intentionally redesigned
   - if a route uses no stack header, set that route’s `headerShown: false` in the navigator layout itself; do not wait for the screen component to mount and then flip header visibility with a runtime `Stack.Screen` override
5. Data warm-up rule:
   - when a parent process screen already knows the next drill-in screen will likely open, prefetch that screen’s primary queries
6. Layout stability rule:
   - keep destination screen scaffolds stable on first mount
   - prefer swapping inner list/content states over swapping the entire screen card structure
7. This rule is especially enforced for Modifiers and other drill-in management flows where first-open transitions are repeated operationally.
8. Navigator timing rule:
   - header visibility must be resolved before the transition begins
   - route-level runtime header flips are treated as a known first-frame flicker source and should be refactored into static stack layout options

### 1.10 Stable First-Mount Scaffold (Locked)

1. Canonical reusable pattern name is **Stable First-Mount Scaffold**.
2. Canonical implementation term is **Single-Tree State Rendering**.
3. First-render UI must keep a stable outer scaffold mounted while state changes resolve.
4. Tree stability rules:
   - do not swap between separate wrapper components for the same route when a shared screen can accept a `layout` or mode prop
   - keep the primary list/card subtree mounted across loading, error, empty, and data states when feasible
   - prefer `ListEmptyComponent`, overlays, inline state containers, or inner child swaps over replacing the full screen surface
5. This pattern should be applied when the initial transition flicker is caused by first-mount component replacement rather than navigation timing alone.
6. This lock complements, but does not replace, **Flicker-Free Initial Screen Transition** governance.

### 1.11 POS Numeric Bottom Sheet Keyboard Governance (Locked)

1. Canonical reusable pattern name is **POS Numeric Bottom Sheet Keyboard**.
2. Canonical implementation/component name is **BAIPosNumpadSheet**.
3. Pattern scope:

- all number inputs
- all money/currency inputs
- default numeric entry surface for operational forms moving forward.

4. Required structure:

- bottom-anchored sheet container
- fixed numeric layout: `1-9`, `00`, `0`, `backspace`
- explicit in-sheet confirm action (`check` key)

5. Reuse rule:

- do not create per-screen bespoke numeric keypad UIs when this pattern applies
- consume/reuse `BAIPosNumpadSheet` and keep key order/interaction semantics consistent.

6. Money-governance compatibility:

- this lock standardizes the input surface, not money-domain validation semantics
- existing precision, formatting, and cap governance for money inputs remains mandatory.

7. Visual consistency:

- spacing, border treatment, and elevation must follow existing sheet/surface tokens
- only minimal token-level tuning is allowed per host screen.

8. Forward implementation allowance:

- bottom sheets and modals are approved interaction patterns for new and refactored flows moving forward
- choose the pattern that best matches task complexity and expected interruption level
- implementations must remain token-based, deterministic, and aligned with existing navigation/overlay governance.

9. Cross-reference:

- for canonical pattern selection criteria, follow **1.13 Bottom Sheet vs Modal Selection Governance**.

### 1.12 Currency Display Context Governance (Locked)

1. Canonical policy name is **Currency Display Context Governance**.
2. Money display must be selected by context, not by a single global “symbol only” rule.
3. Default operational rule:
   - day-to-day operational surfaces (POS, inventory item lists/details, form inputs, catalog management) should use **compact money display**
   - compact money display means symbol-first output when the symbol is unambiguous for the business currency (example: `$12.00`)
4. Explicit financial rule:
   - finance, audit, reporting, exports, invoices, settlements, and any multi-currency comparison surface must use **explicit money display**
   - explicit money display means `CURRENCY_CODE amount` (example: `USD 12.00`)
5. Ambiguity rule:
   - if a compact symbol is unavailable or still ambiguous, formatter fallback must remain code-based rather than inventing a symbol
6. Shared formatter rule:
   - all user-facing money text must route through shared money formatting utilities
   - per-screen currency string concatenation and per-screen prefix stripping are disallowed
   - shared formatters must expose both `compact` and `explicit` display modes
7. Change-control rule:
   - existing operational surfaces should remain compact by default
   - a screen may switch to explicit display only when its product role is intentionally financial, auditable, or multi-currency by design

### 1.13 Bottom Sheet vs Modal Selection Governance (Locked)

1. Bottom sheets and modals are both approved interaction patterns.
2. Use a **bottom sheet** when the task is lightweight, context-adjacent, and should preserve the host screen state/visibility.
3. Use a **modal** when the task is disruptive, requires stronger focus/confirmation, or must isolate decision flow before returning.
4. Selection must prioritize deterministic completion paths and predictable dismissal behavior for the chosen pattern.
5. Implementations must remain token-based and aligned with existing overlay, navigation, and busy-state governance.

---

## 2. Locked Development Order (Phased Roadmap)

### Phase 0 — Foundation (stability first)

**Goal:** stable runtime + navigation + API connectivity + UI primitives.

Must be stable before feature expansion:

- App providers: Paper theme, React Query, safe areas, display mode, busy overlay
- Networking: environment-driven baseURL selection (simulator/emulator/device)
- Auth: OTP-first registration + verify-email issuing tokens; refresh token rotation (atomic DB + reuse detection); single-flight mobile refresh + 401 retry; resend cooldown
- Onboarding: business creation and selection; **currency derived from country and immutable**
- UI primitives must be established and used everywhere:
  - `BAIScreen`, `BAISurface`, `BAIText`, `BAIButton`, `BAITextInput`, `BAISwitchRow`, `BAIPressableRow`

**Exit criteria**

- Login → Home tab route is deterministic.
- Tabs are stable: **Home | Inventory | POS | Settings**
- Phone orientation: portrait-only; tablet supports landscape.
- Global busy overlay works and is theme-aware.

### Phase 1 — Inventory Items + Ledger (core value)

**Goal:** inventory correctness and daily operational usability.

Deliverables:

- Item list (phone) + two‑pane list/detail (tablet)
- Item detail + activity audit view
- Adjust stock (ledger write) with **idempotencyKey replay safety**
- Watermark + ETag caching strategy
- Barcode scanning: camera-only + manual fallback
- Product images: unified media pipeline (Supabase signed upload)
- Photo selection must use **two distinct pre-crop selector screens**:
  - **Photo library (OS picker)** for deep media discovery across albums/folders.
  - **Recent photos (BizAssist grid)** for instant access to the latest captures.
    Both selectors **only return an asset URI** and must **not** preview, edit, or upload. They feed into the mandatory pipeline:
    **Pick → 1:1 crop → Normalize (1200×1200 JPEG) → Upload → Commit**.
- POS Tile editor (Create Item flow): tile label + Image/Color tabs, deterministic navigation,
  pre-create local crop → post-create upload, and tile fields owned by Catalog (posTileMode/posTileColor[/posTileLabel]).
  After crop, return to **Edit POS Tile** and require explicit **Save** before returning to Create Item.
- Custom in-app cropper (Expo 54): 1:1 POS tile default with future aspect-ratio parameter,
  no rotation in Phase 1, output cap target ≤6 MB (hard cap ≤8 MB) and max dimension 2048 px.

**Exit criteria**

- Create item, adjust stock, and verify the resulting movement is append-only and replay-safe.
- OnHand is correct after offline/duplicate submission simulation.

### Phase 2 — Categories (organization layer)

Settings-owned category lifecycle under `Settings → Categories`:

- Business-scoped category Create/Edit/Archive/Restore, optional color, sort order, active flag.
- User-scoped visibility under `Settings → Categories → Category visibility` (Hide/Restore, non-destructive).
- Category Visibility list filtering must use a **Switch** (`Show hidden categories`) because this is a boolean include/exclude filter on the current dataset.
- Do **not** use `GroupTabs` for hidden visibility filtering; tabs are reserved for peer view modes (e.g., Active/Archived lifecycle browsing).
- **Create Category post-save redirect lock:** After a successful Category Create save (outside picker-return flows), redirect to the **Manage Categories** ledger screen for the active context (Settings create -> `Settings → Categories`; Inventory create -> `Inventory Categories` ledger), not to Category Detail.
- Inventory/POS operational flows expose only category pickers plus `+ Add Category` shortcut to Settings create flow.

### Phase 3 — Services (ProductType=SERVICE)

Unified Product model; services share categories and units; inventory tracking disabled.

#### Phase 3 — Services Governance (Locked)

- **Reference name:** Service Unit Semantics (v1)
- **Canonical source:** Service unit approved list/default/pinning must be maintained in `docs/SERVICE_UNIT_CATALOG_SEED.md` and kept in sync with both mobile runtime and API seed catalogs.
- **Unit selection is required** for Services. Do **NOT** silently default to `Hour`.
  - UI may _visibly_ preselect a suggested unit (e.g., `Service` or `Session` if available), but it must be shown and changeable.
- **Service Cost is optional** and used only for reporting:
  - Cost is interpreted as **cost per selected unit** for margin reporting.
  - Cost must never drive inventory behavior.
- **POS quantity semantics (Services)**:
  - Default quantity when added to cart: `1`.
  - Time-based units allow decimals per `Unit.precisionScale`.
  - Engagement/target units are integer-only.
  - Changing unit resets quantity to `1` (no auto-conversion).
- **Lifecycle (Services)**:
  - States: `Active` / `Archived` only.
  - Archived services are excluded from POS and cannot be added to cart.
  - Services have **no stock UI**, **no Adjust Stock**, and **no InventoryMovement activity** surfaces.
  - Visibility toggles (if used) are Settings-owned only (not Inventory-owned).

### Phase 4 — Discounts (POS-only pricing modifiers)

Discounts affect pricing only; **never** alter inventory ledger.

Discounts follow **ledger-definition governance** (same class as Units, Categories, Taxes, Payment Methods):

- **Never deletable.** Deletion is prohibited to preserve audit integrity.
- Allowed lifecycle actions only: **Create**, **Edit metadata**, **Archive** (`isActive=false`, `archivedAt`), **Restore**.
- **Archived discounts remain visible in historical sales records** (show as “(Archived)” when referenced).
- **Pickers show only active discounts** by default; management surfaces show **Active + Archived** via a filter.
- Add **Discount Visibility** as a user-scoped preference surface (mirrors Unit Visibility / Category Visibility):

> **Critical rule:** Discounts are ledger definitions. They must NEVER be deleted under any circumstance once referenced by a sale. Only Archive/Restore is allowed.

- Visibility is **non-destructive** and reversible: **Hide** / **Restore**.
- Visibility is **separate** from Archive/Restore lifecycle governance.
- **Pickers show only active + not hidden** discounts, plus the **currently selected** discount even if hidden.
- Selecting a hidden discount from a historical context auto-restores visibility.
- Management surface: `Settings → Discounts → Discount visibility` screen with explicit Hide/Restore actions (no switches).

### Phase 5 — Modifiers (Set Governance + Item/Service Attach)

Modifier behavior is locked to a reusable-set model aligned to the approved UX reference.

#### Phase 5 — Modifiers Governance (Locked)

- **Canonical owner split:**
  - Modifiers module owns modifier sets/options, set rules, and availability operations.
  - Catalog module owns attaching selected modifier sets during Item/Service create/edit save.
  - POS module owns checkout-time modifier selection validation and line-price application.
- **Attach parity rule:** Create Item and Create Service must use the same modifier attach pattern and semantics.
- **Operational status rule:** `Sold out` is an availability state for modifier options (not delete/archive).
  - Sold-out options remain visible in modifier management screens.
  - Sold-out options are excluded from POS selection but remain displayable with sold-out labeling.
- **Ledger clarity rule:** Modifier set ledger rows must expose summary state (`x available`, `y sold out`) where sold-out options exist.
- **Process UX rule (upsert/detail):**
  - Deterministic process navigation (`Exit` with explicit fallback, `Save` explicit).
  - Inline option name/price editing with reorder and remove affordances.
  - Set-level destructive actions require explicit, globally-scoped warning language.
- **Async safety rule:** bulk availability updates must use blocking Loading Overlay and completion toast/snackbar closure.
- **Toast placement rule (top-first):** completion toasts/snackbars should render at top by default in Modifiers flows to avoid collision with bottom tabs, bottom sheets, and keyboard surfaces.
- **Destructive action rule:** modifier-set and modifier-option Delete may be exposed only through **Lifecycle Eligibility Gating**. If the entity has been used or is still referenced, the destructive action must remain **Archive**.
- **Governance non-regression:** UDQI precision/quantity behavior, tablet-first parity, Back vs Exit law, and POS structural architecture must remain unchanged.

### Phase 6 — Options + Variations (Catalog Definition + Product/Service Attach)

Option + Variation behavior is locked to a reusable option-set model where **Options** is the authoring source for option-generated combinations and **Variations** is the resulting sellable output for deterministic Item/Service attach flows.

#### Phase 6 — Options + Variations Governance (Locked)

- **Canonical owner split:**
  - Mobile Options module owns reusable option-set/value authoring and selection UI.
  - Catalog module owns attaching selected option sets, previewing resulting combinations, and persisted variation writes during Item/Service create/edit save.
  - Inventory module owns stock movement only.
  - POS module does not own option authoring or variation runtime selection.
- **Attach parity rule:** Create Item and Create Service must use the same option/variation attach pattern and semantics when the feature is exposed in both contexts.
- **Canonical connected flow rule:** the authoring flow must stay deterministic and drill-in based:
  - parent `Create Item` / `Edit Item` entry
  - `Options` section (`Add options` / `Edit`)
  - `Select Options`
  - `Create Option` (optional)
  - per-set `Option Values`
  - `Create Variations`
  - return to parent item/service flow with updated `Variations`
- **Parent-screen state rule:**
  - when no option sets are attached, `Options` is the primary setup section for option-generated variations
  - `Variations` should appear only after a valid generation/update result exists
  - when option sets already exist, the parent screen must show the selected option-set summary and the resulting variation rows
- **Option-set authoring rule:**
  - reusable option sets and reusable option values remain the source of truth
  - `Create Option` requires Option set + Display name + at least one option value
  - option values support inline add, inline edit, remove, and deterministic reorder
- **Option-value selection rule:**
  - each attached option set must have at least one selected value before variation generation
  - duplicate labels inside the same option set are invalid
  - per-set detail supports search, value selection, inline add value, and explicit `Done`
- **Variation generation rule:**
  - generated variations must be based only on selected option values and must be deduped by canonical `variationKey`
  - `Create Variations` must distinguish `Update existing variations` from `New variations` whenever prior valid variations already exist
  - expanding selected option values must not silently destroy still-valid existing variations
- **Add Variation rule:**
  - within the option-driven model, `Add Variation` is a constrained combination picker, not a free-form manual variation
  - it may create only a valid not-yet-existing combination across attached option sets
  - duplicate variation attempts must fail locally with explicit modal/inline feedback before any parent save
- **Draft safety rule:** changing selected option sets or selected values invalidates stale variation selections and must clear/rebuild variation draft state deterministically.
- **Process UX rule:**
  - full-screen drill-in screens only; no dropdowns or drawers
  - one dominant job per screen
  - explicit `Exit`/`Done`/`Next`/`Create` closure actions
  - deterministic return to the same parent draft
- **Async safety rule:** option set create/update/archive/restore, option value create/update/archive/restore, and parent Item/Service save must remain Busy/Loading Overlay governed and double-tap safe.
- **Data model rule:** v1 uses the additive catalog relation model:
  - `OptionSet`
  - `OptionValue`
  - `ProductOptionSet`
  - `ProductOptionSetValue`
  - `ProductVariation`
  - `ProductVariationValue`
    New schema abstractions are not required for v1 authoring flow.
- **Variation stock rule:**
  - variation rows may expose `Manage Stock` drill-in during item/service authoring when that flow is approved on the host surface
  - stock movement semantics remain inventory-governed and must not be re-authored inside the options screens themselves
- **Explicit non-goals:**
  - no variation-level sold-out scheduling inside the options feature flow
  - no POS variation runtime selection
  - no option-flow-owned inventory ledger behavior
- **Governance non-regression:** UDQI precision/quantity behavior, tablet-first layout rules, Back vs Exit law, POS layout locks, and existing inventory ledger semantics must remain unchanged.

---

## Sellable Lifecycle Governance (Locked — Option A)

### Canonical Rule

Inventory owns lifecycle for all sellable entities.  
Settings owns configuration only.

This governance applies to:

- `ProductType = PHYSICAL` (Items)
- `ProductType = SERVICE` (Services)

### Lifecycle Ownership

**Inventory tab must own:**

- Create
- Edit
- Archive
- Restore
- Operational detail hubs

**Settings tab must NOT provide:**

- Archive for Items
- Restore for Items
- Archive for Services
- Restore for Services

Unless a future explicit architectural decision centralizes all master data governance inside Settings.

### Lifecycle Model (Uniform)

Sellables support only:

- `ACTIVE`
- `ARCHIVED`

Rules:

- Archived sellables are excluded from POS.
- Archived sellables remain visible in historical records.
- Hard delete is prohibited.
- Lifecycle controls must not be duplicated across tabs.

### Architectural Rationale

- Preserves the mental model: Inventory = what I sell; Settings = how the system behaves.
- Prevents asymmetric behavior between Items and Services.
- Aligns with tablet-first operational workspace design.
- Avoids lifecycle drift across modules.

---

## 3. Architecture Decisions (Locked)

### 3.0 GTIN Governance (Global Trade Item Number)

GTIN (Global Trade Item Number) is the global barcode identifier standard covering UPC, EAN, ISBN, and related formats.

#### Canonical Rules

- GTIN is **optional** for Products.
- If provided, GTIN must be **unique per business scope**.
- GTIN must support barcode scanning and fast POS lookup.
- GTIN must **not** be required for Services (`ProductType = SERVICE`).
- The GTIN field must be **hidden or disabled** for Services.

#### UI Standard

- Label must be: `GTIN (Barcode)`
- Placeholder must be: `Scan or enter UPC / EAN / ISBN`

#### Rationale

- Ensures retail-grade interoperability.
- Prevents duplicate catalog entries.
- Enables future barcode-based auto-create workflows.
- Maintains clear separation between physical products and services.

### 3.1 Feature-first architecture

BizAssist follows a feature-first modular monolith structure. Do not introduce “misc” dumping grounds.

### 3.2 Unified Product model

Items and Services use a single Product model with `ProductType` driving behavior. Do not fork schemas.

### 3.3 Inventory = ledger-first

Inventory is an **append-only** movement ledger. Never “edit” historical movements in-place.

### 3.4 Media governance

Clients never choose buckets. Clients send a `MediaKind` (product-image/avatar/cover/etc). Server resolves:

- bucket allowlist
- business-scoped storage path
- signed upload mint + commit

AI background removal is allowed **only** for product images, not avatars/covers/logos.

#### 3.4.1 Media delivery governance (public vs private) — locked

BizAssist must use a tiered delivery policy by `MediaKind` to balance POS-grade performance with privacy.

**Public delivery (stable URLs; cache-friendly; recommended for speed):**

- `product-image` → bucket `product-media` **PUBLIC**
- `business-logo`, `business-cover` → bucket `business-assets` **PUBLIC** (default)

**Private delivery (signed URLs; used only when privacy is required):**

- `user-avatar`, `user-cover` → bucket `user-media` **PRIVATE** by default

**Rules (non-negotiable):**

1. **Never sign what you do not need to protect.** Signed URLs introduce cache misses and list/tile latency in mobile and web.
2. **Public buckets must return stable public URLs** via `getPublicUrl(path)` (no token query params). These URLs are the canonical delivery format for product and business branding images.
3. **Private buckets may return signed URLs**, but the API must not rotate URL identities on every read:
   - Cache `{bucket, path} → {signedUrl, expiresAt}` and reuse until near expiry (refresh only within a short grace window).
4. **Cache headers for public images must be aggressive** for immutable assets (e.g., `public, max-age=31536000, immutable`) to maximize CDN + client cache hit rate.
5. **Mobile must use `expo-image` with disk cache** for list/tile surfaces.
6. **Web must consume the same delivery URLs** (public URLs for product/branding; signed URLs only for user-private media when required).

**Objective:** Product and POS tile imagery must be instant after first load; privacy controls apply only to user identity media.

### 3.5 Tablet interaction standard

Tablets follow the same “no dropdowns, no drawers” rule as phones. Tablets gain:

- persistent panes
- inline inspectors
- always-visible toolbars

### 3.6 Abuse caps (business-scoped)

The API must enforce business-scoped caps to prevent abuse, with defaults:

- Categories: 200
- Custom units: 100

Limits are env-configurable and must return explicit error codes so mobile can surface friendly messages.

### 3.7 React Query freshness governance (staleTime tiers)

`staleTime` controls cache freshness and must be set by feature volatility. It is **not** a polling mechanism.

Use these canonical tiers:

- **Operational (Inventory/POS stock- and movement-critical screens):** `30_000`
- **Shared/default reference reads:** `120_000`
- **Settings/admin management screens (low churn):** `300_000`
- **Long-lived metadata:** `24 * 60 * 60 * 1000`

If a flow requires true near-real-time multi-device convergence, prefer event-driven invalidation (or websockets) over lowering staleTime globally.

### 3.8 API Contract + State Management + File Structure Governance (Locked)

This lock defines the architecture stabilization contract between `BizAssist_api` and `BizAssist_mobile`.

#### 3.8.1 API contract lock

- API contracts must remain backward-compatible by default.
- Canonical response contract:
  - success: `{ success: true, data, meta? }`
  - error: `{ success: false, error: { code, message }, data? }`
- All non-exempt endpoints must return structured `error.code`.
- List endpoints must expose consistent pagination metadata when returning collections.
- HTTP semantics must remain RESTful:
  - `GET` read
  - `POST` create/command
  - `PATCH` partial update
  - `DELETE` destructive/archive endpoints where policy allows

#### 3.8.2 State management lock (mobile)

- Server state is React Query-owned.
- Write operations must be implemented as React Query mutations in module hooks (not ad hoc screen handlers).
- Query keys must be domain-owned factories; avoid literal ad hoc query-key arrays in screens.
- Cache invalidation must be deliberate and scoped; avoid broad invalidations unless required.
- UI state remains local unless explicitly global by policy (auth/session/theme/business context).

#### 3.8.3 File structure lock

- Feature-first structure is mandatory across API and mobile.
- API modules must follow canonical layering (`controller/service/repository/routes/validators/types`).
- Mobile Expo route files must stay thin wrappers; feature logic belongs in module screens/hooks/services.
- Shared folders must remain generic; feature logic must not leak into shared infra.
- Remove stale/duplicate files after safe migration; avoid parallel legacy/new paths long-term.

#### 3.8.4 Baseline audit findings (2026-03-05)

- `P0` response/error envelope drift exists across endpoints and middleware responses.
- `P1` endpoint namespace drift exists for settings-owned configuration domains.
- `P1` list pagination metadata is inconsistent across multiple list contracts.
- `P1` mobile writes are frequently screen-local API calls instead of mutation hooks.
- `P1` query-key governance drift exists due to literal key usage in invalidation paths.
- `P1` route-wrapper thinness is inconsistent in several mobile settings/inventory routes.
- `P2` stale/legacy folder paths and duplicate ownership surfaces are present.

#### 3.8.5 Implementation sequence (locked)

- Phase 1: Normalize API envelopes and structured error shape across controllers/middleware.
- Phase 2: Introduce settings-owned endpoint namespaces with backward-compatible aliases.
- Phase 3: Standardize list pagination metadata and align mobile clients.
- Phase 4: Refactor mobile writes into module mutation hooks and centralize query keys.
- Phase 5: Enforce thin Expo route wrappers and module-owned feature logic placement.
- Phase 6: Add governance gates (contract tests, key checks, ownership checks) to prevent regressions.

---

## 4. Navigation Governance (Hard Screen Transition)

### 4.1 Tabs are canonical

- Home
- Inventory
- POS
- Settings

### 4.2 Route determinism

Critical flows must use deterministic transitions:

- After login/onboarding: `replace("/(app)/(tabs)/home")`
- Pickers must return to the correct parent route (use returnTo params)
- Back behavior must be deterministic (provide fallback routes)
- Discounts edit-save flows must `replace()` to their ledger route (Inventory and Settings) and must not be intercepted by process back/pop guards.

### 4.3 Phone/tablet splits

Every “real” screen must support:

- `screen.phone.tsx`
- `screen.tablet.tsx`
- `screen.tsx` as the router entry that selects the variant

Rule: if a refactor touches phone or tablet, the counterpart must be updated in the same PR.

---

## 5. UX Governance (Operational Screens)

### 5.1 No dropdowns, no drawers

Use:

- full-screen pickers
- drill-in editors
- list rows with chevrons

### 5.2 Action gating (anti-double-tap)

- All write actions use the global Busy Overlay (`useAppBusy`).
- All navigation actions must be disabled/guarded while in-flight.

### 5.3 States are mandatory

Every screen must define:

- Loading
- Error + Retry
- Empty + Guidance CTA
- Partial failure tolerance when safe (non-blocking refresh)

### 5.4 Search affordances (Operational)

- If the search field includes an inline clear affordance ("x"), do not add a separate "Search Results For" label row or a dedicated "Clear Search" button.

### 5.4 Input validation (Inventory/POS)

- Only apply strict regex validation to format-specific fields (e.g., POS tile label, SKU, barcode).
- Product name/description must allow broad characters; do not over-restrict.
- POS tile label: max 6 characters, letters/numbers/spaces only.
- Short Note must be capped at 200 characters.
- Short Note UI must render 2 visible lines and auto-grow to about 4 lines before inner scrolling.
- Short Note must not use regex-rejection validation beyond hygiene transforms (trim, whitespace normalization, control-character filtering).

### 5.5 Copy casing (UI text)

- **Subtitles and helper text must be sentence case.** Do not title-case these lines.

### 5.5 Text Input Hygiene (Global)

- All text inputs across the app must apply silent sanitation and field-specific validation.
- Control-character filtering is mandatory for all user-editable text fields.
  Strip non-printable ASCII control characters; allow newline/tab only where the field supports multiline/tab semantics.
- Allow normal text, punctuation, and emoji in general-purpose text fields (names, descriptions, notes, labels).
- Sanitize in Mobile (while typing and/or before submit) and in API (Zod preprocess) so hygiene is enforced server-side.
- Hygiene transforms must be invisible to the user and must not surface as regex-format errors.
- Validators must be field-specific and documented; avoid blanket regexes on general-purpose text.

### 5.6 Copy Casing (UI)

- **Subtitles, helper text, and hints use sentence case**, not Title Case.
- **Body copy should not be Title Case**.

### 5.7 Status icon defaults (archived/hidden)

- For inventory/settings management surfaces, default/status icons are locked to the following defaults:
  - **All Services default:** `Ionicons` with `name="briefcase-outline"`
  - **Category default:** `Ionicons` with `name="layers-outline"`
  - **Discount default:** `MaterialCommunityIcons` with `name="tag-outline"`
  - **Units default:** `MaterialCommunityIcons` with `name="ruler-square"`
  - **Archived:** `MaterialCommunityIcons` with `name="archive-outline"`
  - **Hidden:** `MaterialCommunityIcons` with `name="eye-off"`
- Moving forward, Archive icon implementations must use this same archived default (`MaterialCommunityIcons` + `archive-outline`) on management surfaces.
- For Discounts Visibility action controls, restore icon is locked to:
  - **Restore action:** `MaterialCommunityIcons` with `name="eye"`
- Canonical snippets:
  - `import Ionicons from '@expo/vector-icons/Ionicons';`
  - `<Ionicons name="briefcase-outline" size={24} color="black" />`
  - `<Ionicons name="layers-outline" size={24} color="black" />`
  - `import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';`
  - `<MaterialCommunityIcons name="tag-outline" size={24} color="black" />`
  - `<MaterialCommunityIcons name="ruler-square" size={24} color="black" />`
  - `<MaterialCommunityIcons name="archive-outline" size={24} color="black" />`
  - `<MaterialCommunityIcons name="eye-off" size={24} color="black" />`
  - `<MaterialCommunityIcons name="eye" size={24} color="black" />`
- Icon tint/shade standardization is locked for consistency:
  - On management list rows, all icon families (leading icons + trailing chevrons) must use the same theme tint token.
  - Default icon tint token is `theme.colors.onSurfaceVariant` (or fallback `onSurface` if unavailable).
  - Do not mix icon shades within the same row.
- Canonical tint pattern:
  - `const iconTint = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;`
  - `<Ionicons name="layers-outline" size={20} color={iconTint} />`
  - `<MaterialCommunityIcons name="chevron-right" size={30} color={iconTint} />`
- When both states can apply, archived takes precedence for status representation.

### 5.8 Count label pluralization (dynamic titles)

- Any UI count label/title must be dynamically pluralized based on the numeric value.
- Use singular for `1` and plural for all other values (`0`, `2+`, compact forms).
- Applies to badges, pills, headers, and inline count labels.
- Example pattern: `1 ITEM` vs `2 ITEMS` (or `1.2K ITEMS`).

### 5.9 Process wording convention (Close vs Cancel vs Back)

- Process screens must use **Close/Exit** semantics in the header-left control.
- Process-screen in-content secondary actions must be labeled **Cancel**.
- **Back** is reserved for history/navigation contexts (detail/picker/list drill-in), not process cancellation.

### 5.10 Badge token consistency (count chips/pills)

- Badge text color must use `theme.colors.onSurfaceVariant ?? theme.colors.onSurface`.
- Use compact counts for badge values.
- For visibility scopes, prefer consistent scope labels: `ALL`, `VISIBLE`, `HIDDEN`.
- Avoid mixed wording variants (`TOTAL` or noun-heavy badge text) when sibling surfaces use scope-only labels.

### 5.11 Color swatch accessibility (selection controls)

- Color swatches must expose human-readable accessibility labels (e.g., `Blue`, `No Color`).
- Swatches must expose selected/disabled state through accessibility state.
- Swatches must provide a short accessibility hint for selection action.

### 5.12 Cancel action behavior (deterministic safety contract)

- `Cancel` must never persist writes (no create/update/archive/restore side effects).
- `Cancel` discards unsaved local state for the current process session.
- `Cancel` navigation must be deterministic:
  - `replace(returnTo)` when `returnTo` is valid and non-self.
  - Otherwise `replace(fixedFallbackRoute)` for the owning flow.
- Do not use arbitrary history pop as cancel behavior.
- If unsaved changes exist, `Cancel` must show a discard guard (`Keep editing` / `Discard changes`).
- `Cancel` must be idempotent and navigation-locked to prevent double-tap race conditions.
- Semantics remain strict:
  - Header-left process control = `Close/Exit`
  - In-content secondary action = `Cancel`
  - `Back` = history/drill-in navigation only

## Button Shape Governance (Locked)

**STATUS:** LOCKED  
**CHANGE LEVEL:** Requires Architecture Review

### Canonical Rules

1. **Full-width buttons are rounded only.**
   - Full-width CTAs must use the current rounded rectangle radius token.
   - Full-width buttons must never render as pill.
2. **Compact/short-width buttons may be pill only by explicit opt-in.**
   - Pill shape is allowed only for compact utility controls (filters, segmented actions, inline contextual actions, tag-like controls).
   - Pill is never inferred automatically.
3. **Primary destructive and transactional actions are never pill when full-width.**
   - Includes Save, Create, Confirm, Checkout, Archive, Restore, and equivalent full-width primary CTAs.
4. **Enforcement is centralized in canonical `BAIButton`.**
   - If `shape="pill"` is requested on a full-width button, it must auto-fallback to `shape="default"` and warn in DEV only.
5. **Geometry communicates hierarchy.**
   - Rounded full-width CTAs represent decisive primary flow actions.
   - Compact pill controls represent secondary contextual actions.
6. **Enterprise-grade structure over trendy softness.**
   - Shape consistency is a governance contract, not a per-screen styling preference.

### Masterplan UX Principles Evaluation (Button Shape Governance)

- **Halo Effect:** consistent CTA geometry increases perceived quality, coherence, and trust.
- **Cognitive Load & Fluency:** shape hierarchy keeps primary decisions obvious and reduces interpretation cost.
- **Micro-Interactions & Peak-End Rule:** full-width primary actions feel decisive at interaction peak; flow endings feel stable and intentional.

---

## 6. Quality Gates (Definition of Done)

A feature is not “done” until:

- Busy/disabled guards are implemented
- Empty/error/loading states exist
- Phone + tablet behavior validated
- No hidden interaction controls added
- API contracts match mobile types
- Inventory writes are idempotent and ledger-correct

See: `docs/PR_CHECKLIST.md`

---

## 7. Theme Governance (Background)

**Canonical app background colors (use everywhere):**

- Light: `#F1F5F9` (`baiSemanticColors.surfaces.background`)
- Dark: `#202124` (`baiSemanticColors.surfacesDark.background`)

**Usage rules:**

- All screens must use `BAIScreen` (it consumes `useAppBackground`).
- Do not hardcode screen background colors in feature code.
