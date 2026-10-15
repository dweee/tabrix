# tabrix fork

Upstream: https://github.com/guodaxia103/tabrix

Base revision: `f207a3a2837e9fe93711b5313a214e07c172b85d`. Upstream ancestry and license attribution are retained.

Nix packaging and system modules, plus browser tab/group tools and native-server connection handling.

## Build

```sh
nix build .#packages.<system>.<package>
```

Supported packages and native systems are listed in `nix/platforms.json`.

## CI

Build and upstream-sync drafts are under `ci/disabled/` and are inactive there.
Darwin and Linux builds are separate where supported. See
[ci/ATTIC.md](ci/ATTIC.md) for optional binary-cache publication and
[ci/UPSTREAM-SYNC.md](ci/UPSTREAM-SYNC.md) for upstream maintenance.

Copied upstream history excludes the internal artifact paths configured in
`history_exclude`. Original authors, dates and messages remain; affected commit
IDs differ. Upstream synchronization applies the same filter before merging.
