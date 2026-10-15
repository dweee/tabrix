# Helpers for Chrome Native Messaging host manifests.
{ lib }:
let
  hostName = "com.tabrix.nativehost";
  extensionId = "dgonickdaadgcggeloahmhkibnbenade";

  packageRoot =
    package:
    if (package.passthru.tabrixLayout or "source") == "release" then
      "${package}/lib/node_modules/@tabrix/tabrix"
    else
      "${package}/lib/tabrix";

  hostScript = package: "${packageRoot package}/dist/run_host.sh";
  cliScript = package: "${packageRoot package}/dist/cli.js";

  mkManifestForPackage =
    package:
    builtins.toJSON {
      name = hostName;
      description = "Node.js Host for Browser Bridge Extension";
      path = hostScript package;
      type = "stdio";
      allowed_origins = [ "chrome-extension://${extensionId}/" ];
    };

  # Relative config paths (without the JSON filename) for user-level registration.
  userRelPaths = {
    linux = {
      chrome = "google-chrome/NativeMessagingHosts";
      chromium = "chromium/NativeMessagingHosts";
      helium = "net.imput.helium/NativeMessagingHosts";
    };
    darwin = {
      chrome = "Library/Application Support/Google/Chrome/NativeMessagingHosts";
      chromium = "Library/Application Support/Chromium/NativeMessagingHosts";
      helium = "Library/Application Support/net.imput.helium/NativeMessagingHosts";
    };
  };

  # Absolute system-level directories (NixOS / nix-darwin). Browsers missing
  # here (Helium on Linux) are user-level only.
  systemDirs = {
    linux = {
      chrome = "/etc/opt/chrome/native-messaging-hosts";
      chromium = "/etc/chromium/native-messaging-hosts";
    };
    darwin = {
      chrome = "/Library/Google/Chrome/NativeMessagingHosts";
      chromium = "/Library/Application Support/Chromium/NativeMessagingHosts";
      helium = "/Library/Application Support/net.imput.helium/NativeMessagingHosts";
    };
  };

  supportedBrowsers = [
    "chrome"
    "chromium"
    "helium"
  ];
in
{
  inherit
    hostName
    extensionId
    packageRoot
    hostScript
    cliScript
    mkManifestForPackage
    userRelPaths
    systemDirs
    supportedBrowsers
    ;
}
