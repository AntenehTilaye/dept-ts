# UI standard

The interface bar for every DeptTS screen, distilled from current practice (September 2026) and
applied through the shared components in `src/components/{ui,shell,patterns}`. New pages are
composed from these patterns; a page that needs something new adds it here first.

## Principles (researched)

1. **Shell first, pages second.** One application shell (collapsible sidebar with grouped, keyboard-navigable entries and an active state; header with breadcrumb, command palette, inbox badge, user menu, theme switch) is inherited by every route, so navigation never has to be relearned between modules (shadcn/ui admin patterns; Fuselab enterprise UX guide 2026).
2. **Progressive disclosure and dense hierarchy.** Headline numbers and summaries first, detail on demand (drawers, expandable rows, hover cards); dense data is packed on a strict grid with a clear typographic hierarchy rather than spread out with whitespace (Fuselab; NN/g).
3. **Data tables are real tables.** Sortable, filterable, paginated, sticky header, row selection where bulk actions exist, empty/loading/error states, every action reachable by keyboard (`src/components/patterns/DataTable.tsx` on TanStack Table).
4. **Forms reduce effort.** Eliminate, automate, simplify (NN/g EAS); smart defaults; microcopy under fields; inline validation on the field that failed; the primary action is one button; destructive actions confirm.
5. **Every empty state does three jobs** (NN/g): states the system status ("no reminders in the next 14 days"), teaches what fills the space, and offers a direct pathway (a button that creates the first record).
6. **Errors are precise and actionable.** What failed, why, what to do next; never a bare "Something went wrong" when the cause is known; keep the user's input.
7. **Feedback is immediate and non-blocking.** Toasts for success/failure of actions, optimistic pending states on buttons, skeleton loading for route transitions.
8. **Accessibility is structural (WCAG 2.2 AA).** Radix primitives for overlays and menus; visible focus that is never obscured (2.4.11); targets of at least 24 × 24 px (2.5.8); no drag-only interactions (2.5.7); consistent placement of help (3.2.6); labels on every control; colour never the only signal; `prefers-reduced-motion` respected.
9. **Responsive by default.** Mobile: sidebar becomes a sheet, tables gain horizontal scroll with a sticky first column, forms stack; nothing depends on hover alone.
10. **Consistency over novelty.** Tokens from `globals.css` (OKLCH palette, radius, spacing) and the shadcn-style components are the only source of visual style; light and dark themes ship together.

## Patterns

| Pattern | Component | Use |
| --- | --- | --- |
| Page header | `patterns/PageHeader` | title, description, breadcrumb, primary + secondary actions |
| Stat tiles | `patterns/StatCard` | headline numbers with delta/label |
| Data table | `patterns/DataTable` | any list over ~10 rows: sorting, text filter, column toggles, pagination, empty state |
| Empty state | `patterns/EmptyState` | status + learning cue + pathway |
| Form section | `patterns/FormSection` + `forms/Field` | grouped fields with help text and inline errors |
| Confirm | `ui/alert-dialog` (via `patterns/ConfirmButton`) | destructive or irreversible actions |
| Detail drawer | `ui/sheet` | inspect or edit without leaving the list |
| Feedback | `sonner` toasts through `ActionForm` | outcome of every server action |
| Command palette | `shell/CommandPalette` (Ctrl/⌘ K) | jump to any page or record type |
| List + editor | `patterns/ListLayout` | registry pages: table on the left, add/edit card on the right, stacked on phones |
| URL filters | `patterns/SegmentedLinks` | filter/window/scope switches that live in the query string (shareable, no JS needed) |
| Loading | `patterns/PageSkeleton` via `loading.tsx` | route transitions show a title-and-list skeleton, never a spinner |

## Rules learned the hard way

- **Only valid HTML nesting.** An `<li>` inside an `<li>` (the first breadcrumb) made React throw the
  server tree away on hydration; anything typed before hydration was lost and the e2e suite went
  flaky. The components project now fails on React's nesting warnings (`tests/setup/dom.ts`).
- **Client-only submit handlers are gated on hydration** (`useHydrated`, `method="post"` fallback) so
  a submit that beats React never sends credentials as a GET query string.
- **Card titles are headings** (`CardTitle` renders `h2`), the page title is the only `h1`.
- **Every table column definition goes through `columnHelper<Row>()`**; pages map their Prisma rows to
  a plain row type before handing them to a table component.

## Sources

- Fuselab, *Enterprise UX design guide 2026* — https://fuselabcreative.com/enterprise-ux-design-guide-2026-best-practices/
- DEV, *How to build a modern admin dashboard with shadcn/ui in 2026* — https://dev.to/ausrobdev/how-to-build-a-modern-admin-dashboard-with-shadcnui-in-2026-3477
- NN/g, *Designing empty states in complex applications* — https://www.nngroup.com/articles/empty-state-interface-design/
- NN/g, forms and error topics — https://www.nngroup.com/topic/forms/ , https://www.nngroup.com/topic/errors/
- W3C, *What's new in WCAG 2.2* — https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- shadcn/ui templates and projects surveyed — https://adminlte.io/blog/shadcn-ui-templates/ , https://www.shadcndeck.com/blog/shadcn-ui-projects-examples-2026
