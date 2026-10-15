# nix-darwin module factory. Call from flake.nix with flake packages.
{
  sourcePackage,
  releasePackage,
  extensionPackage,
}:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib) mkIf mkMerge mkDefault;
  manifestLib = import ./manifest.nix { inherit lib; };
  cfg = config.programs.tabrix;
  package = cfg.package;
  manifestText = manifestLib.mkManifestForPackage package;
  hostFile = "${manifestLib.hostName}.json";
  nodeBin = "${package.passthru.nodejs or pkgs.nodejs_22}/bin/node";
in
{
  options.programs.tabrix = import ./options.nix { inherit lib; };

  config = mkMerge [
    {
      programs.tabrix.package = mkDefault (
        if cfg.useReleasePackage then releasePackage else sourcePackage
      );
      programs.tabrix.extensionPackage = mkDefault extensionPackage;
    }

    (mkIf cfg.enable {
      environment.systemPackages = [ package ];

      system.activationScripts.tabrixNativeHost.text = lib.concatMapStringsSep "\n" (
        browser:
        let
          dir = manifestLib.systemDirs.darwin.${browser};
        in
        ''
          echo "tabrix: installing Native Messaging host for ${browser} at ${dir}"
          mkdir -p "${dir}"
          cat > "${dir}/${hostFile}" <<'TABRIX_EOF'
          ${manifestText}
          TABRIX_EOF
          chmod 644 "${dir}/${hostFile}"
        ''
      ) cfg.browsers;

      environment.variables = {
        CHROME_MCP_NODE_PATH = nodeBin;
      };
    })
  ];
}
