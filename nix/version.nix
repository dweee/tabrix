# Release pins and fixed-output hashes for Nix packaging.
# When bumping a release: update `version`, clear hashes to lib.fakeHash (or empty),
# rebuild packages, and commit the new hashes + nix/release/package-lock.json.
{
  version = "2.7.0";

  # Source package: pnpm store from fetchPnpmDeps (fetcherVersion = 4)
  pnpmDepsHash = "sha256-ijFedXSc8KOS6e3hi5wyfQFhuiGo+tZ5kiozkQHcg+0=";

  # Release package: npmDepsHash for nix/release (buildNpmPackage)
  npmDepsHash = "sha256-TrRpHITV8QTeoHLO77ZKITNmToYFCdXBxPBvFlAh0P8=";

  # Unpacked extension built from this tree (WXT chrome-mv3). Empty → fakeHash.
  extensionPnpmDepsHash = "sha256-ijFedXSc8KOS6e3hi5wyfQFhuiGo+tZ5kiozkQHcg+0=";
}
