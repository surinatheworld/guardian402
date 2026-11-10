# Guardian402 dashboard design standard

The approved reference is `docs/design/guardian-heroui-v3.html`. This standard
applies to every route, shared component and interaction in the dashboard.

- White mode only: canvas `#f0f1f3`, white surfaces, foreground `#222326`,
  muted `#686a72`, action `#27282d`. Use the tokens in `globals.css`.
- Use HeroUI v3 components and shared dashboard components. Keep component
  anatomy, states and spacing consistent; extend shared components instead of
  creating a one-off version. Pin dependencies in the workspace lockfile.
- Cards use white surfaces, approximately 22px corners, generous 24–28px
  padding and the shared subtle surface shadow. Avoid borders around every item
  or nesting decorative cards. Use real data and meaningful grouping.
- Headings have weight 700 and clear hierarchy. Body copy is readable; controls
  have at least 42px height, substantial labels and visible focus states.
  Use tabular numbers for amounts and monospace only for technical identifiers.
- Navigation uses a solid dark active item, muted inactive items and a compact
  mobile layout. Status colors communicate actual risk or system state and are
  paired with text; no colour-only meaning.
- Motion is short and functional, respects reduced-motion preferences and does
  not delay data or user input. No gradients, glow, glass effects, decorative
  orbs, fake charts, invented metrics, gratuitous icons or generic AI copy.
- Keep demo/testnet labels explicit. Separate Guardian risk, simulation results,
  signed verdicts and on-chain execution. Preserve wallet confirmation and
  explain consequences of changes to owner controls.
- Each change must cover responsive, keyboard, loading, error, empty and long
  content states where applicable. Verify the affected flows and run dashboard
  build, typecheck and tests as appropriate. Review rendered UI when available.
