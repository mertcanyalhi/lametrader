# Spec: web profile selection — global bottom status bar + selected-profile store (#39, iteration 1)

- Status: implemented
- Touches: `web` only.
  New `lib/selected-profile/` (a `localStorage`-backed store + a React Context exposing `useSelectedProfile()`), a `useProfiles()` query hook (`lib/hooks/profiles.ts`), a global `StatusBar` shell piece (`components/layout/status-bar.tsx`) mounted by `AppShell`, and a `ProfileSelector` (`components/profiles/profile-selector.tsx`) that lists `GET /profiles` and drives the selection.
  Backend untouched — the profiles API already exists (`GET /profiles`).

## Goal

Introduce the **currently selected profile** as a global app concept and the first slice of UI for it: a persistent bottom status bar (visible on every page) holding a profile selector that lists the server's profiles, lets the user pick one, and persists the choice to `localStorage`.
The selection is what later drives chart indicator overlays; this iteration lands the selection concept and its surface, not the create/edit/delete flows.

## Background

Issue #39 specifies a global profile selector and full create / edit / delete management, originally in the topbar.
Two refinements steer this work: the selector lives in a **new global bottom status bar** (not the topbar), and the issue is delivered in **iterations**.
This is iteration 1 — selection store + selector + the bottom bar.
Iteration 2 adds the create / edit / delete dialogs ("Manage profiles…"); iteration 3 relocates the chart's symbol + period controls into this same bottom bar and syncs `?profile=` in the chart URL.

The selected profile id is **client state** persisted to `localStorage`, mirroring the existing `lib/theme.ts` + `lib/theme-context.tsx` and `lib/sidebar-store.ts` patterns; the profile *objects* are **server state** via TanStack Query (`useProfiles()`).
Per `packages/web/CLAUDE.md`, components never touch `localStorage` directly — the `lib/selected-profile/` module owns it.

## Selection model

- **Source of truth**: the global `useSelectedProfile()` store (`{ profileId, setProfileId }`), persisted to `localStorage`.
- **First-run / reconciliation**: given the fetched profiles and the stored id, the effective selection is the stored id when it still names a listed profile; otherwise the first **enabled** profile; otherwise `null` ("No profile").
  When the resolved id differs from the stored one (first run, or the stored profile vanished), the selector persists the resolved id so the choice sticks.
- **Selecting** an option sets the global selection (and persists it).
- A profile with `enabled === false` is still listed and selectable, shown with a muted "disabled" hint.

## Acceptance criteria

Each bullet maps to exactly one test (jsdom for the React pieces; `fetch`-boundary mock for the query hook, mirroring `use-config.test.tsx`).

- [x] `getStoredProfileId` returns `null` when no id has been stored.
- [x] `setStoredProfileId(id)` persists an id that `getStoredProfileId` then reads back.
- [x] `setStoredProfileId(null)` clears the stored id (`getStoredProfileId` returns `null` after).
- [x] `resolveSelectedProfileId` keeps the stored id when it names a listed profile.
- [x] `resolveSelectedProfileId` falls back to the first enabled profile when the stored id is `null`.
- [x] `resolveSelectedProfileId` falls back to the first enabled profile when the stored id names no listed profile (e.g. a deleted profile).
- [x] `resolveSelectedProfileId` returns `null` when there are no profiles.
- [x] `useSelectedProfile()` exposes the stored id and `setProfileId` both updates the value and persists it to `localStorage`.
- [x] `useProfiles()` issues `GET /api/profiles` and returns the profiles.
- [x] `ProfileSelector` lists the fetched profiles and shows the selected profile's name on the trigger.
- [x] `ProfileSelector` updates the global selection (and persists it) when a different profile is chosen.
- [x] `ProfileSelector` defaults to the first enabled profile and persists it when nothing is stored.
- [x] `ProfileSelector` shows "No profile" when the server returns no profiles.
- [x] `ProfileSelector` marks a disabled profile with a muted "disabled" hint in the list.
- [x] `AppShell` renders the global `StatusBar` (the bottom bar is present on the page).

## End-to-end expectation

The browser-side e2e is the web build (`packages/web/tests/e2e/build.e2e.test.ts`) staying green with the profile-selection code compiled in.
The end-user happy path — opening the app, seeing the bottom status bar, and picking a profile that persists across reloads — is asserted by the jsdom component tests above (mocked `fetch` / a real `QueryClient`), the realistic surface for this UI.

## Out of scope (later iterations)

- Create / edit / delete profile dialogs and the "Manage profiles…" entry (iteration 2).
- The chart relocating its symbol + period controls into this bottom bar, and `?profile=` URL sync (iteration 3).
- The no-profile **warning** in the indicator panel and indicator overlays driven by the selection (the overlay task).
- Editing a profile's `scope` or attached indicators.

## Surprises

(none yet)
