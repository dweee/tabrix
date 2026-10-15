# NixOS module factory. Call from flake.nix with flake packages.
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

      environment.etc = lib.listToAttrs (
        map (
          browser:
          let
            dir = manifestLib.systemDirs.linux.${browser};
            etcKey = lib.removePrefix "/etc/" "${dir}/${hostFile}";
          in
          {
            name = etcKey;
            value = {
              text = manifestText + "\n";
              mode = "0644";
            };
          }
        ) (lib.filter (browser: manifestLib.systemDirs.linux ? ${browser}) cfg.browsers)
      );

      warnings = map (
        browser:
        "programs.tabrix: no system-wide Native Messaging dir for ${browser} on Linux; use the Home Manager module."
      ) (lib.filter (browser: !(manifestLib.systemDirs.linux ? ${browser})) cfg.browsers);

      environment.sessionVariables = {
        CHROME_MCP_NODE_PATH = nodeBin;
      };
    })
  ];
}
