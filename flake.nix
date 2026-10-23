{
  description = "Tabrix — Chrome Native Messaging host and MCP bridge (NixOS / nix-darwin / Home Manager)";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/02c087f3fe673c9e317f206a627cb6b910336dbe";
  };

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      # legacyPackages is memoised per system; `import nixpkgs` built a fresh
      # package set on every call (once more per Home Manager evaluation).
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      versionInfo = import ./nix/version.nix;

      # Exclude bulky / irrelevant paths from the source FOD and build closure.
      srcFilter =
        path: _type:
        let
          base = baseNameOf path;
        in
        !(builtins.elem base [
          ".github"
          "ci"
          ".fork-ci.json"
          "flake.nix"
          "flake.lock"
          "nix"
          ".git"
          "node_modules"
          ".output"
          ".wxt"
          "dist"
          "coverage"
          "result"
          ".specstory"
          ".cursor"
          ".tmp"
          ".private-artifacts"
          ".private-tests"
          ".playwright-mcp"
          ".claude"
          ".omx"
        ]);

      mkPackages =
        pkgs:
        let
          src = lib.cleanSourceWith {
            src = ./.;
            filter = srcFilter;
            name = "tabrix-source";
          };
        in
        {
          tabrix = pkgs.callPackage ./nix/packages/tabrix.nix {
            inherit src;
            version = versionInfo.version;
            pnpmDepsHash = versionInfo.pnpmDepsHash;
          };

          tabrix-release = pkgs.callPackage ./nix/packages/tabrix-release.nix {
            version = versionInfo.version;
            npmDepsHash = versionInfo.npmDepsHash;
          };

          tabrix-extension = pkgs.callPackage ./nix/packages/tabrix-extension.nix {
            inherit src;
            version = versionInfo.version;
            pnpmDepsHash = versionInfo.extensionPnpmDepsHash;
          };

          default = pkgs.callPackage ./nix/packages/tabrix.nix {
            inherit src;
            version = versionInfo.version;
            pnpmDepsHash = versionInfo.pnpmDepsHash;
          };
        };

      mkModuleArgs =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          packages = mkPackages pkgs;
        in
        {
          sourcePackage = packages.tabrix;
          releasePackage = packages.tabrix-release;
          extensionPackage = packages.tabrix-extension;
        };
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          p = mkPackages pkgs;
        in
        {
          inherit (p) tabrix tabrix-release tabrix-extension;
          default = p.tabrix;
        }
      );

      apps = forAllSystems (
        pkgs:
        let
          pkg = (mkPackages pkgs).tabrix;
        in
        {
          tabrix = {
            type = "app";
            program = lib.getExe pkg;
          };
          default = {
            type = "app";
            program = lib.getExe pkg;
          };
        }
      );

      devShells = forAllSystems (
        pkgs:
        let
          nodejs = pkgs.nodejs_22;
          pnpm = pkgs.pnpm_10.override { nodejs-slim = nodejs; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              pkgs.python3
              pkgs.pkg-config
              pkgs.sqlite
              pkgs.nixfmt
            ];
            shellHook = ''
              echo "Tabrix Nix/dev shell — Node $(node -v), pnpm $(pnpm -v)"
            '';
          };
        }
      );

      checks = forAllSystems (
        pkgs:
        let
          packages = mkPackages pkgs;
        in
        {
          tabrix = packages.tabrix;
          tabrix-release = packages.tabrix-release;
          tabrix-extension = packages.tabrix-extension;
        }
      );

      nixosModules.tabrix =
        { pkgs, ... }:
        {
          imports = [
            (import ./nix/modules/nixos.nix (mkModuleArgs pkgs.stdenv.hostPlatform.system))
          ];
        };
      nixosModules.default = self.nixosModules.tabrix;

      darwinModules.tabrix =
        { pkgs, ... }:
        {
          imports = [
            (import ./nix/modules/darwin.nix (mkModuleArgs pkgs.stdenv.hostPlatform.system))
          ];
        };
      darwinModules.default = self.darwinModules.tabrix;

      homeModules.tabrix =
        { pkgs, ... }:
        {
          imports = [
            (import ./nix/modules/home-manager.nix (mkModuleArgs pkgs.stdenv.hostPlatform.system))
          ];
        };
      homeModules.default = self.homeModules.tabrix;
    };
}
