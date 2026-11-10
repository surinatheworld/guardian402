# Guardian workspace concept

This extends the approved HeroUI v3 concept. The interactive export is
`../guardian-workspace-pages.html`; these sources do not change the live dashboard.

## Visual contract

- Keep white surfaces, charcoal navigation and primary actions, substantial
  controls, existing typography, spacing, and radii. No gradients.
- Use semantic color consistently across tags, decisions, notifications, and
  progress. Do not assign decorative colors to unrelated cards.

| Meaning                         | Color     | Text on soft surface | Soft surface |
| ------------------------------- | --------- | -------------------- | ------------ |
| Authorized, executed, confirmed | `#00875a` | `#006b46`            | `#dff6eb`    |
| Blocked, risky, reverted        | `#d12f3f` | `#b02030`            | `#ffe5e8`    |
| Pending or approaching a limit  | `#b76800` | `#8b4b00`            | `#fff0cc`    |
| Registry or informational       | `#285ee0` | `#224fb9`            | `#e7eeff`    |

Only high emphasis authorization uses a solid green tag with white text.
Always retain a visible status label. Registry metadata must remain distinct
from on-chain authorization.

## Layout contract

- Resource tables use `wx-resource-table`. Cells align vertically in the middle.
  Agent identity and authorization each use a 27px first line, a 6px gap, and
  matching metadata line heights. Do not compensate with positional offsets.
- At 1000px and below, resource rows become stacked records. Keep every field
  and action. At 760px and below, navigation moves above the content and settings
  wrap. At 620px and below, transaction rows stack while keeping amounts and time.
- At 400px and below, resource actions get their own row. Never hide important
  columns to make a mobile layout fit. Inputs use at least 16px text on mobile.
- Dialogs fit the visible portion of an embedded preview. The body scrolls when
  necessary, the close action stays at the top right, and opening a dialog brings
  it into view. Preserve the export's iframe sandbox and CSP.
- Keep React Aria Shadow DOM support enabled before mounting. Check actual mouse
  and keyboard interaction after any component or mounting change.

## Validation

Checked all eight pages in the browser at 320, 390, 768, 1024, and 1280px:
navigation, horizontal overflow, and content bounds. Also checked mobile policy
history, alert rules, transaction amounts/time, and the agent dialog at 320px
with both 900px and 568px viewport heights. These are concept checks, not tests
of the live API or wallet flows.
