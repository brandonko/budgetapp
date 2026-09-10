# Navigation and visual preferences

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

## Navigation

- The Ledger brand links to the dashboard home page.
- On the dashboard, center the view/year/month reporting controls in the header.
- Keep page-level destinations in the top-right hamburger menu: Dashboard,
  Transactions, Import data, Classifications, and Settings. Use native disclosure
  semantics, connect the toggle to the navigation region, and keep its accessible
  name and expanded state synchronized before returning focus on Escape.
- Use the same menu across pages, clearly mark the current page, close it on an
  outside click or Escape, and return focus to the menu button after Escape.
- Keep native navigation separate from ARIA menu widgets. Each app HTML page
  must load the shared deferred navigation script and connect its summary to a
  unique, named navigation region. Discover pages in regression tests so new
  destinations cannot silently miss this contract.
- Preserve link-event propagation so the all-time page can save pending flags
  before navigation, and remain on the page with its queued changes if saving
  fails. Closing the disclosure must not bypass that guard.
- Inline transaction Filters also use an expanded-state toggle with a unique
  controlled panel, not popup-menu semantics. Check all shared variants without
  changing legitimate combobox/listbox or native details interactions.
- Organize Settings as accessible tabs, beginning with Exports. Add future user
  preferences there instead of adding unrelated controls to the dashboard or
  import page.

## Visual preferences

- Keep the visual language simple, spacious, and editorial rather than looking
  like a dense enterprise dashboard.
- Use the existing neutral canvas, serif display typography, restrained green
  accent, soft borders, and subtle shadows.
- Total spent stays visually neutral.
- Green communicates income or surplus; red communicates deficit or destructive
  action.
- Forms and dialogs must use plain labels, sign guidance, accessible focus
  states, and clear confirmation language.
- Avoid unnecessary charts, animation, navigation layers, or decorative assets.
