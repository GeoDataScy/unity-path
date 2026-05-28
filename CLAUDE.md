# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server on port 8080 (host `::`). HMR overlay is disabled.
- `npm run build` — production build (forces `NODE_ENV=production`; do not remove — required for correct bundling on Vercel).
- `npm run build:dev` — development-mode build, useful for debugging bundle issues.
- `npm run lint` — ESLint over the repo. `@typescript-eslint/no-unused-vars` is off; `react-refresh/only-export-components` warns.
- `npm run test` — Vitest single run (jsdom). Tests live at `src/**/*.{test,spec}.{ts,tsx}`; global setup is `src/test/setup.ts`.
- `npm run test:watch` — Vitest watch mode.
- Run a single test: `npx vitest run src/path/to/file.test.tsx` or filter by name with `-t "<pattern>"`.
- No typecheck script — use `npx tsc --noEmit -p tsconfig.app.json` if needed (note: project has `strict: false`, `strictNullChecks: false`, `noImplicitAny: false`).

## Architecture

Single-page React/Vite app talking directly to Supabase from the browser. No server-side code in this repo — all business logic lives in Postgres (RPCs, RLS, triggers). Vercel hosts the SPA; `vercel.json` rewrites all paths to `index.html` for client-side routing.

### Two user worlds, two layouts

`src/App.tsx` defines the entire route tree. Two top-level branches share auth plumbing but diverge in UX:

- `/workspace/*` → `AgentLayout` (`src/layouts/AgentLayout.tsx`). Agent pages live in `src/pages/agent/`. Layout publishes an `AgentOutletContext` (`userId`, `fullName`, `canViewAllTickets`, `canRegisterDuplicateEmails`) consumed via `useOutletContext`.
- `/dashboard/*` → `ManagerLayout` (`src/layouts/ManagerLayout.tsx`). Manager pages are the `Dashboard*.tsx` files at `src/pages/`. Layout publishes `ManagerOutletContext` (date range, agent filter, etc.).

Both layouts:
1. Call `supabase.auth.getSession()`, read `profiles` for `role`/permission flags, and cross-redirect (`manager` hitting `/workspace` → `/dashboard`, and vice-versa).
2. Poll the `me_status` RPC every 30s + on `focus`/`visibilitychange`; if the account is deactivated they bounce to `/blocked` and clear `sb-*` keys from `localStorage`.
3. Fire `agent_heartbeat` RPC so managers see who is online in real time.

When adding a protected page, mount it under the right layout — do not duplicate the auth dance.

### Feature folders

`src/features/<domain>/` is where domain logic lives. Each folder typically owns: TanStack Query hooks (`use*Query.ts`), dialogs/forms, and domain types. Pages in `src/pages/` are thin compositions of these.

Current domains: `agent` (daily metrics, check-in flow), `dashboard` (manager metrics + audit views), `refunds`, `services` (tickets/atendimentos + follow-ups), `training` (welcome videos), `transfers` (cross-agent ticket handoff with notifications bell).

### Supabase integration

- Client: `src/integrations/supabase/client.ts` — singleton typed with the generated `Database`. Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env`.
- Types: `src/integrations/supabase/types.ts` is generated (header says "do not edit directly"). Regenerate after schema changes via the Supabase CLI; don't hand-edit.
- Migrations: `supabase/migrations/*.sql`. New migrations follow `YYYYMMDDHHMMSS_<slug>.sql` and frequently define RPCs as `SECURITY DEFINER` functions with explicit RLS-style guards inside the function body.
- All metrics and dashboards go through RPCs (`agent_daily_metrics`, `dashboard_metrics`, `dashboard_audit`, `dashboard_refund_metrics`, `dashboard_refund_audit`, `dashboard_follow_up_detail`, `dashboard_hourly_pattern`, `dashboard_channel_detail`, etc.). When a manager view needs new aggregation, add/extend an RPC rather than computing in the client.
- `supabase/config.toml` references a different `project_id` (`aiypwzylxoeppnmsqlok`) than the live `.env` project (`kjkyyqxqrqsdozjyyuon`). The runtime app uses `.env`; treat `config.toml` as stale for CLI linking.

### Schema gotchas (read before writing SQL)

- `services.id`, `services.user_id`, `refunds.user_id`, `ticket_transfers.from_user_id`/`to_user_id` are **`text`**, not `uuid`. Compare with `auth.uid()::text`. RPC overloads that take `uuid` agent ids have been dropped — keep the `text` variant.
- `services.service_date` is **`text`** (agent-chosen timestamp). Cast `::timestamptz` for range comparisons.
- `refunds.request_date` and `refunds.completion_date` are **`text`**. Cast `::date` in metrics RPCs.
- Follow-up business rule: a follow-up is blocked until 18:00 São Paulo time on the day of the previous interaction, measured against `service_date`.
- Several RPCs intentionally exclude same-day follow-ups when the ticket has `has_tracking_code = true` to avoid double-counting tracking-code interactions.

### Permission flags vocabulary

Per-user capabilities are boolean columns on `profiles`. Use capability names, not job titles — there is no "supervisor" concept in code. Current flags:

- `can_view_all_tickets` — agent can see other agents' tickets in dashboards/searches.
- `can_register_duplicate_emails` — agent can open a new ticket for an email that already has a ticket with a different agent (UX bypass only; RLS is unchanged).

Add new capabilities the same way: one boolean per capability, named after what it allows.

### Cross-agent ticket transfers

`ticket_transfers` is the handoff request log (separate from `services`). The ticket itself never moves owners — `to_user_id` is the original owner being asked to continue. RPCs `my_transfer_notifications` and `my_transfer_history` back the bell UI in `src/features/transfers/`. Unique partial index forbids two pending requests from the same agent for the same ticket.

### Single React instance (do not "fix" this)

`vite.config.ts` aliases and dedupes `react`, `react-dom`, and both jsx runtimes to a single copy. This exists to prevent "Invalid hook call" caused by Lovable/`lovable-tagger` pulling in a second React. Don't add `optimizeDeps` exclusions or path aliases that break this.

### Path aliases

`@/*` → `./src/*` everywhere (Vite, Vitest, tsconfig, shadcn components.json). Import as `@/components/...`, never relative `../../`.

### shadcn/ui

Components live in `src/components/ui/` and are tracked in source — they are not a dependency. Style is `default`, base color `slate`, no class prefix. Add new components via `npx shadcn@latest add <name>`; they are then yours to edit.

### Tests

Vitest + Testing Library + jsdom. Setup file mocks `window.matchMedia`. Coverage today is light (one example test); when adding tests, place them next to the unit under test as `*.test.ts(x)`.

## Conventions

- App is in Portuguese (pt-BR) — UI strings, route segments (`/workspace`, `/reembolsos`, `/metricas`), commit messages, and SQL comments. Match that when adding strings.
- Toasts go through `useToast` from `src/hooks/use-toast.ts` (shadcn) or `sonner` — both are mounted in `App.tsx`.
- Theme: `next-themes` with class strategy; dark mode toggled via `ThemeToggle` in headers.
- TanStack Query is the single source of truth for server state. Optimistic updates are used in hot paths (e.g., "Meus Atendimentos" table) — preserve that pattern; the table is filtered to the last 30 days at query level for perf.
- Don't compute manager metrics in the client. If the number doesn't exist in an RPC yet, extend the RPC.
