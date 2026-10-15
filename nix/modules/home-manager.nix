# Home Manager module factory. Call from flake.nix with flake packages.
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
  isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
  nodeBin = "${package.passthru.nodejs or pkgs.nodejs_22}/bin/node";
  cliJs = manifestLib.cliScript package;
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
      home.packages = [ package ];

      home.sessionVariables = {
        CHROME_MCP_NODE_PATH = nodeBin;
        CHROME_MCP_PORT = toString cfg.port;
      };
    })

    (mkIf (cfg.enable && !isDarwin) {
      xdg.configFile = lib.listToAttrs (
        map (browser: {
          name = "${manifestLib.userRelPaths.linux.${browser}}/${hostFile}";
          value = {
            text = manifestText + "\n";
          };
        }) cfg.browsers
      );
    })

    (mkIf (cfg.enable && isDarwin) {
      home.file = lib.listToAttrs (
        map (browser: {
          name = "${manifestLib.userRelPaths.darwin.${browser}}/${hostFile}";
          value = {
            text = manifestText + "\n";
          };
        }) cfg.browsers
      );
    })

    (mkIf (cfg.enable && cfg.extensionPackage != null) {
      home.file.".local/share/tabrix/extension".source = "${cfg.extensionPackage}/share/tabrix/extension";
    })

    (mkIf (cfg.enable && cfg.daemon.enable && !isDarwin) {
      systemd.user.services.tabrix = {
        Unit = {
          Description = "Tabrix MCP Chrome Bridge Daemon";
          After = [ "network.target" ];
        };
        Service = {
          Type = "forking";
          Environment = [
            "CHROME_MCP_NODE_PATH=${nodeBin}"
            "CHROME_MCP_PORT=${toString cfg.port}"
          ];
          ExecStart = "${nodeBin} ${cliJs} daemon start";
          ExecStop = "${nodeBin} ${cliJs} daemon stop";
          PIDFile = "%h/.tabrix/daemon.pid";
          Restart = "on-failure";
          RestartSec = "5";
        };
        Install = {
          WantedBy = [ "default.target" ];
        };
      };
    })

    (mkIf (cfg.enable && cfg.daemon.enable && isDarwin) {
      launchd.agents.tabrix = {
        enable = true;
        config = {
          Label = "com.tabrix.daemon";
          ProgramArguments = [
            nodeBin
            cliJs
            "daemon"
            "start"
          ];
          RunAtLoad = true;
          KeepAlive = false;
          EnvironmentVariables = {
            CHROME_MCP_NODE_PATH = nodeBin;
            CHROME_MCP_PORT = toString cfg.port;
          };
          StandardOutPath = "${config.home.homeDirectory}/.tabrix/daemon.log";
          StandardErrorPath = "${config.home.homeDirectory}/.tabrix/daemon.log";
        };
      };
    })
  ];
}
