{
  lib,
  stdenv,
  nodejs_22,
  pnpm_10,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
  python3,
  pkg-config,
  sqlite,
  rsync,
  cctools,
  src,
  version,
  pnpmDepsHash,
}:
let
  nodejs = nodejs_22;
  # Prefer overriding nodejs-slim (pnpm warns if nodejs is overridden directly).
  pnpm = pnpm_10.override { nodejs-slim = nodejs; };
  pname = "tabrix";

  # CLI-only workspace so fetch never resolves extension-only deps.
  restrictWorkspace = ''
    cat > pnpm-workspace.yaml <<'EOF'
    packages:
      - 'app/native-server'
      - 'packages/shared'
    EOF
  '';
in
stdenv.mkDerivation (finalAttrs: {
  inherit pname version src;

  postPatch = restrictWorkspace;

  # Hoisted linker yields a classic node_modules tree that can be copied offline.
  pnpmInstallFlags = [ "--config.node-linker=hoisted" ];

  pnpmWorkspaces = [
    "@tabrix/shared"
    "@tabrix/tabrix..."
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
    hash = if pnpmDepsHash == "" then lib.fakeHash else pnpmDepsHash;
    postPatch = restrictWorkspace;
  };

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    makeWrapper
    python3
    pkg-config
    rsync
  ]
  # gyp-mac-tool archives the bundled SQLite with Apple libtool.
  ++ lib.optionals stdenv.hostPlatform.isDarwin [ cctools ];

  buildInputs = [ sqlite ];

  env = {
    npm_config_build_from_source = "true";
    npm_config_nodedir = "${nodejs}";
  };

  preBuild = ''
    # pnpmConfigHook installs with --ignore-scripts, and `pnpm rebuild` is then a
    # silent no-op, so compile the addon directly against the store Node.
    pushd node_modules/better-sqlite3
    node ${pnpm}/libexec/pnpm/dist/node_modules/node-gyp/bin/node-gyp.js rebuild --release
    popd
  '';

  buildPhase = ''
    runHook preBuild

    pnpm --filter @tabrix/shared build
    pnpm --filter @tabrix/tabrix build:direct

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/tabrix"
    cp -a app/native-server/package.json "$out/lib/tabrix/"
    cp -aR app/native-server/dist "$out/lib/tabrix/"

    # Hoisted node_modules at the workspace root (and package-local links).
    # Copy with -L so the store path is self-contained.
    if [ -d node_modules ]; then
      rsync -aL --delete node_modules/ "$out/lib/tabrix/node_modules/"
    fi
    # Ensure workspace package is a real directory with built dist.
    rm -rf "$out/lib/tabrix/node_modules/@tabrix/shared"
    mkdir -p "$out/lib/tabrix/node_modules/@tabrix"
    rsync -aL packages/shared/ "$out/lib/tabrix/node_modules/@tabrix/shared/"
    rm -rf "$out/lib/tabrix/node_modules/@tabrix/shared/node_modules"

    # Ensure Chrome Native Messaging host uses the same Node that built better-sqlite3.
    echo -n "${nodejs}/bin/node" > "$out/lib/tabrix/dist/node_path.txt"
    chmod +x "$out/lib/tabrix/dist/run_host.sh" "$out/lib/tabrix/dist/cli.js" || true

    mkdir -p "$out/bin"
    makeWrapper ${nodejs}/bin/node "$out/bin/tabrix" \
      --set CHROME_MCP_NODE_PATH "${nodejs}/bin/node" \
      --add-flags "$out/lib/tabrix/dist/cli.js"
    makeWrapper ${nodejs}/bin/node "$out/bin/tabrix-stdio" \
      --set CHROME_MCP_NODE_PATH "${nodejs}/bin/node" \
      --add-flags "$out/lib/tabrix/dist/mcp/mcp-server-stdio.js"

    runHook postInstall
  '';

  # Without the addon Tabrix silently falls back to in-memory session storage.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    ${nodejs}/bin/node -e "new (require('$out/lib/tabrix/node_modules/better-sqlite3'))(':memory:').close()"
    runHook postInstallCheck
  '';

  passthru = {
    inherit nodejs;
    tabrixLayout = "source";
  };

  meta = {
    description = "Tabrix native messaging host and MCP CLI (built from source)";
    homepage = "https://github.com/guodaxia103/tabrix";
    changelog = "https://github.com/guodaxia103/tabrix/blob/main/CHANGELOG.md";
    license = lib.licenses.mit;
    mainProgram = "tabrix";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
