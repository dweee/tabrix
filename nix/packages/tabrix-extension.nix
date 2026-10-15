{
  lib,
  stdenv,
  nodejs_22,
  pnpm_10,
  fetchPnpmDeps,
  pnpmConfigHook,
  writableTmpDirAsHomeHook,
  rsync,
  src,
  version,
  pnpmDepsHash,
}: let
  nodejs = nodejs_22;
  pnpm = pnpm_10.override {nodejs-slim = nodejs;};
  pname = "tabrix-extension";

  # Extension + shared only — do not pull native-server / better-sqlite3.
  restrictWorkspace = ''
    cat > pnpm-workspace.yaml <<'EOF'
    packages:
      - 'app/chrome-extension'
      - 'packages/shared'
    EOF
  '';
in
  stdenv.mkDerivation (finalAttrs: {
    inherit pname version src;

    postPatch = restrictWorkspace;

    pnpmInstallFlags = ["--config.node-linker=hoisted"];

    pnpmWorkspaces = [
      "@tabrix/shared"
      "@tabrix/extension..."
    ];

    pnpmDeps = fetchPnpmDeps {
      inherit (finalAttrs)
        pname
        version
        src
        pnpmWorkspaces
        pnpmInstallFlags
        ;
      inherit pnpm;
      fetcherVersion = 4;
      hash =
        if pnpmDepsHash == ""
        then lib.fakeHash
        else pnpmDepsHash;
      postPatch = restrictWorkspace;
    };

    nativeBuildInputs = [
      nodejs
      pnpm
      pnpmConfigHook
      writableTmpDirAsHomeHook
      rsync
    ];

    env = {
      NODE_ENV = "production";
      MODE = "production";
      CI = "true";
    };

    buildPhase = ''
      runHook preBuild

      pnpm --filter @tabrix/shared build
      # pnpmConfigHook uses --ignore-scripts; WXT needs its generated types.
      pnpm --filter @tabrix/extension exec wxt prepare
      pnpm --filter @tabrix/extension run build:direct

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out/share/tabrix/extension"
      test -f app/chrome-extension/.output/chrome-mv3/manifest.json
      rsync -a app/chrome-extension/.output/chrome-mv3/ "$out/share/tabrix/extension/"
      runHook postInstall
    '';

    passthru = {
      inherit nodejs;
      tabrixLayout = "source";
    };

    meta = {
      description = "Tabrix Chrome/Chromium extension built from this tree (Load unpacked)";
      homepage = "https://github.com/guodaxia103/tabrix";
      changelog = "https://github.com/guodaxia103/tabrix/blob/main/CHANGELOG.md";
      license = lib.licenses.mit;
      platforms = lib.platforms.all;
    };
  })
