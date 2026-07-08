# Spec: Backtest run-form collapsible option groups

- Status: draft
- Touches: `packages/ui/src/pages/backtesting/run-form.tsx` (the `/backtesting` `RunForm` component)

## Goal

Tuck the run form's secondary options behind collapsible, collapsed-by-default groups so the form leads with only the run essentials.
The Period picker and the Run button stay always visible; everything else (initial capital, commissions) moves into named disclosure groups the user opens on demand.

## Grouping design

Two collapsible groups, each a native `<details>`/`<summary>` disclosure (no new dependency; Radix Themes ships no Accordion), both collapsed by default:

- **Capital** — the Initial capital field.
  Beyond the core Profile/Symbol/Period/Run essentials, it has a sensible default (10,000) and is rarely changed, so it belongs behind a disclosure rather than in the always-visible lead.
- **Commission** — the Rate and Fixed commission rows.
  The most advanced, least-used inputs; explicitly requested collapsed.

Always visible (unchanged): the Period range picker, the Run button, the no-strategy/profile hint, and the server-error callout.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] On first render both groups are collapsed: the Initial capital, Commission rate, and Fixed commission inputs are absent, while the Period button and Run button are present.
- [ ] Opening the Commission group reveals both the Commission rate and Fixed commission inputs.
- [ ] Opening the Capital group reveals the Initial capital input.
- [ ] A valid submit with both groups left collapsed still posts the defaults (90-day window, initial capital 10,000, empty commission) — collapsed groups keep their field values.
- [ ] Client-side validation still fires: after opening the Capital group, a non-positive initial capital is rejected without posting.

## End-to-end expectation

Covered by the existing UI e2e (`packages/ui/tests/e2e/backtesting-run.e2e.test.ts`): the run happy path drives the form with its defaults (collapsed groups) and asserts the posted run — no new e2e needed, since the change is presentation-only JSX restructuring over unchanged form logic and schema, exercised end-to-end by that suite submitting collapsed defaults.

## Out of scope

- Any change to the form model, the Yup schema, or `toBacktestRunInput`.
- Persisting a group's open/closed state across renders or sessions.
- A shared reusable collapsible primitive — abstract on the second consumer, not now.

## Surprises

- jsdom does not apply the browser UA stylesheet that hides collapsed `<details>` content, so "hidden when collapsed" must be conditional rendering (children unmounted), not a CSS `open` toggle; react-hook-form's default `shouldUnregister: false` keeps the unmounted fields' default values, which the collapsed-default-submit test verifies.
