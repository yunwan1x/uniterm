# Column settings in the table toolbar

Column visibility now uses a compact Columns icon with a localized title and
accessible label. The text and count badge are removed from the button; the
popover retains search, required columns, reset and local persistence.

All existing picker call sites have moved into their table's existing filter,
action or section-heading row, including Kubernetes/CRDs, containers/images,
files, Redis, MongoDB, Elasticsearch, monitoring, scans, settings and dialogs.
The SQL result grid accepts a specific toolbar element from its parent and moves
its own picker there with Vue Teleport, preserving the grid's dynamic columns and
change handler. Standalone use has a compact fallback row. Removed picker-only
row height is returned to tables.

Validation (2026-11-13): production frontend build passed; 27 relevant column and
Android regression tests passed. Browser fixtures rendered real Docker, Kubernetes
and SQL components: icon-only trigger, localized tooltip, first-toolbar alignment,
column hiding and persistence after reload passed with no page errors. Fixtures
use sample data; this was a UI regression test, not a live cluster/database test.
Repository typecheck remains at 570 existing diagnostics, with no new diagnostics
when line numbers are normalized. Evidence: parent workspace
artifacts/table-toolbar-20261113.
