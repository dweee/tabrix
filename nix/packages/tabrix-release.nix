{
  lib,
  buildNpmPackage,
  nodejs_22,
  makeWrapper,
  python3,
  pkg-config,
  sqlite,
  version,
  npmDepsHash,
}:
let
  nodejs = nodejs_22;
in
buildNpmPackage {
  pname = "tabrix-release";
  inherit version;

  src = ../release;

  npmDepsHash = if npmDepsHash == "" then lib.fakeHash else npmDepsHash;

  inherit nodejs;

  dontNpmBuild = true;

  nativeBuildInputs = [
    makeWrapper
    python3
    pkg-config
  ];

  buildInputs = [ sqlite ];

  env = {
    npm_config_build_from_source = "true";
    npm_config_nodedir = "${nodejs}";
  };

  # npmConfigHook already rebuilds native addons. Locate the published package
  # in the installed tree, pin Node for Native Messaging, and wrap bins.
  postInstall = ''
    tabrix_root="$(find "$out" -path '*/@tabrix/tabrix/package.json' -print -quit | xargs -I{} dirname {})"
    if [ -z "$tabrix_root" ] || [ ! -d "$tabrix_root/dist" ]; then
      echo "error: could not locate @tabrix/tabrix under $out" >&2
      find "$out" -maxdepth 6 -type d >&2 || true
      exit 1
    fi

    echo -n "${nodejs}/bin/node" > "$tabrix_root/dist/node_path.txt"
    chmod +x "$tabrix_root/dist/run_host.sh" "$tabrix_root/dist/cli.js" || true

    # Stable symlink used by modules (tabrixLayout = "source" layout).
    mkdir -p "$out/lib"
    ln -sfn "$tabrix_root" "$out/lib/tabrix"

    rm -f "$out/bin/tabrix" "$out/bin/tabrix-stdio"
    mkdir -p "$out/bin"
    makeWrapper ${nodejs}/bin/node "$out/bin/tabrix" \
      --set CHROME_MCP_NODE_PATH "${nodejs}/bin/node" \
      --add-flags "$out/lib/tabrix/dist/cli.js"
    makeWrapper ${nodejs}/bin/node "$out/bin/tabrix-stdio" \
      --set CHROME_MCP_NODE_PATH "${nodejs}/bin/node" \
      --add-flags "$out/lib/tabrix/dist/mcp/mcp-server-stdio.js"
  '';

  passthru = {
    inherit nodejs;
    tabrixLayout = "source";
  };

  meta = {
    description = "Tabrix native messaging host and MCP CLI (published npm release)";
    homepage = "https://github.com/guodaxia103/tabrix";
    changelog = "https://github.com/guodaxia103/tabrix/releases/tag/v${version}";
    license = lib.licenses.mit;
    mainProgram = "tabrix";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
