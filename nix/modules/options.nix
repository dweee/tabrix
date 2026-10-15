{ lib }: {
  enable = lib.mkEnableOption "Tabrix native messaging host and MCP CLI";

  package = lib.mkOption {
    type = lib.types.package;
    description = ''
      Tabrix CLI package. The flake module sets a default to the source build
      (`packages.tabrix`), or `packages.tabrix-release` when `useReleasePackage`
      is true.
    '';
  };

  useReleasePackage = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = ''
      When true, default `package` to the published npm release package
      (`tabrix-release`) instead of the source build.
    '';
  };

  extensionPackage = lib.mkOption {
    type = lib.types.nullOr lib.types.package;
    default = null;
    description = ''
      Optional unpacked Chrome extension package (`share/tabrix/extension`).
      When set, Home Manager can symlink it under `~/.local/share/tabrix/extension`.
    '';
  };

  browsers = lib.mkOption {
    type = lib.types.listOf (
      lib.types.enum [
        "chrome"
        "chromium"
        "helium"
      ]
    );
    default = [
      "chrome"
      "chromium"
    ];
    description = "Browsers for which to install the Native Messaging host manifest.";
  };

  port = lib.mkOption {
    type = lib.types.port;
    default = 12306;
    description = "MCP HTTP port (`CHROME_MCP_PORT`) when the daemon is enabled.";
  };

  daemon = {
    enable = lib.mkEnableOption "Tabrix user daemon (MCP HTTP server)";
  };
}
