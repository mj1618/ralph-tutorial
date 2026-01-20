## Goal
Build a fast, Excel-like spreadsheet app that runs entirely in the browser (with optional sync later), supports common spreadsheet workflows, and feels “native” (keyboard-first, low-latency editing, large-grid performance).

## Recommended tech stack
- **Frontend**: React + TypeScript + Vite
- **Grid/rendering**: Canvas-based grid renderer (custom) + HTML overlay editor (for IME/accessibility)
- **State**: Zustand (or Redux Toolkit if you prefer stricter patterns); immutable-ish update helpers
- **Formula engine**: Start minimal (parser + evaluator for a core function set); optionally swap/extend later
- **Persistence**:
  - Phase 1: Local-only (`IndexedDB` via `idb`)
  - Later: Server sync (Postgres + API) + real-time collaboration
- **Styling**: Tailwind CSS (fast iteration) + a small design system
- **Testing**:
  - Unit: Vitest
  - Component/interaction: React Testing Library
  - End-to-end: Playwright (light coverage; a few high-signal flows)
- **Quality**: ESLint + Prettier + typecheck in CI

## High-level phases (deliver value early)

### Phase 1 — Core spreadsheet MVP (single-user, local-only)
- **Grid & editing**
  - Render a large grid efficiently (virtualization / canvas)
  - Click to select cell; keyboard navigation (arrows, tab, enter)
  - Edit cell values (double-click / enter) with an input overlay
  - Copy/paste values with system clipboard (TSV/CSV in/out)
  - Undo/redo (command stack)
- **Data model**
  - Workbook → sheet(s) → cells (sparse map)
  - Row/column sizing defaults; basic resizing later
- **Formulas (minimal but useful)**
  - Support `=A1`, `=A1+B2`, parentheses, ranges `A1:A10`
  - Implement functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`
  - Recalc dependency graph (topological order), cycle detection
- **Formatting (minimum)**
  - Number vs text handling
  - Basic cell formatting: bold/italic, alignment (optional in Phase 1)
- **Persistence**
  - Save/load workbook to IndexedDB automatically
  - Export/import as CSV (single sheet)
- **Tests (keep it light but real)**
  - Unit tests for formula parser/evaluator and dependency graph
  - A small set of Playwright tests:
    - Edit cell, navigate, undo/redo
    - Simple formula recalc when precedent changes
    - Copy/paste a 3x3 TSV block into grid

**Definition of done (Phase 1)**: You can open the app, enter values and formulas, copy/paste blocks, undo/redo, refresh the page and keep your workbook, and it stays fast with ~50k visible cells.

### Phase 2 — UX polish + richer spreadsheet features
- **Selection & fill**
  - Multi-cell selection (shift+arrows, mouse drag)
  - Autofill handle (drag down/right), fill series (1,2,3…)
- **Rows/columns**
  - Insert/delete rows/columns
  - Resize rows/columns, freeze header row/column
- **Formatting**
  - More formats: currency, percent, date
  - Conditional formatting (basic rules)
- **Import/export**
  - Better CSV import (delimiter detection, quoting)
  - Export to XLSX (optional; could be Phase 3 if complex)
- **Tests**
  - Add a couple more Playwright flows (multi-selection, insert row shifts refs)

### Phase 3 — Collaboration + backend sync
- **Backend**
  - Postgres + API (Node/Express/Fastify or Next.js API routes)
  - Auth (email magic link or OAuth) + per-workbook permissions
- **Real-time**
  - WebSocket sync + OT/CRDT strategy (choose one; CRDT often simpler for offline-first)
  - Presence, cursors, conflict handling
- **Versioning**
  - Workbook version history + restore
- **Tests**
  - A minimal multi-user Playwright test (two browser contexts) for sync

### Phase 4 — Advanced “Excel-like” power features
- Pivot-table-ish summaries (or “group by” sheet)
- Charts (line, bar) from a selected range
- Named ranges, sheet references (`Sheet2!A1`)
- More functions (lookup, text, date/time)
- Performance hardening (profiling, worker-based recalc, incremental rendering)

## First tasks to start Phase 1 (ordered)
- **Scaffold app**: Vite + React + TS; basic layout with toolbar + grid viewport.
- **Build grid renderer**: virtualization/canvas draw loop + selection highlighting.
- **Cell edit overlay**: controlled input positioned over selected cell; commit/cancel logic.
- **Data model & undo/redo**: sparse cell store + action stack.
- **Formula engine v0**: parse + eval + dependency graph + recalc.
- **Persistence**: IndexedDB save/load + export/import CSV.
- **Smoke tests**: Vitest for formulas; Playwright for core edit/navigate/copy-paste.

