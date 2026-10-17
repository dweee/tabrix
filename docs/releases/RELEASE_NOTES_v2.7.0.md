# Tabrix v2.7.0 Release Notes

v2.7.0 is a product-surface cleanup and browser-read reliability release. It
removes retired experimental surfaces, keeps Tabrix focused on real Chrome plus
MCP control, and makes unreadable browser pages fail in a clearer structured
way.

The supported MCP read/control tools remain backward compatible except for the
removed experimental tools and the safer `chrome_close_tabs` behavior listed
below.

## Highlights

- Focused the public product around real Chrome control, browser object
  awareness, and the Memory / Knowledge / Experience direction.
- Removed old assistant, workflow-builder, local-model, marker, and visual
  editor surfaces that no longer fit the product boundary.
- Improved read-page reliability for Chrome error pages, stale pages, loading
  pages, and unreadable documents.
- Tightened production logging and line-ending governance to reduce release
  drift.

## Breaking Changes

- `chrome_close_tabs` now requires explicit `tabIds` or `url`. Empty arguments
  are rejected instead of closing the active user tab.
- The retired `run_flow`, `list_published_flows`, `search_tabs_content`, and
  `element_picker` tools are no longer part of the public product surface.

## Removed Experimental Surfaces

- Embedded Smart Assistant, Quick Panel, and Agent Chat UI.
- Record/Replay and workflow-builder surfaces.
- Local semantic-search/model stack, including ONNX/WASM model assets and
  vector-search dependencies.
- Element Marker management and Visual Editor v2.

`markedElements` remains as an empty compatibility field in `chrome_read_page`
responses.

## Fixes

- `read_page` and `chrome_get_web_content` now return structured
  `success=false`, `reason=page_unreadable`, `pageType=browser_error_page`
  payloads for Chrome error pages and unreadable documents.
- Navigation and read guidance now separates stale pages, readable pages,
  loading pages, and unreadable pages.
- `read_page` can recover visible DOM/text rows when structured extraction
  returns no business rows, while keeping core logic site-neutral.

## Validation Summary

This release was checked with public deterministic tests and maintainer-held
real-browser scenarios. Public release notes only include safe aggregate
validation information; raw browser artifacts, screenshots, account-specific
URLs, and private benchmark JSON are not published.

The validation focus was:

- real MCP calls against a real browser
- browser-read reliability and fallback behavior
- operation-log write behavior
- primary-tab reuse
- latency and sensitive-data persistence checks

## Known Limitations

- v2.7.0 does not claim broad arbitrary-site API reuse. API reuse remains
  evidence-bounded.
- Same-profile browser reuse is a core Tabrix requirement, but it is not unique
  to Tabrix.
- DOM fallback success is not the same as API or CDP parity.
- Broader observed-endpoint reuse and lifecycle sensing remain future work.
