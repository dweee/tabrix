const LOOPBACK_CLIENT_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_ONLY_LISTEN_HOSTS = new Set(['127.0.0.1', 'localhost']);
const REMOTE_LISTEN_HOSTS = new Set(['0.0.0.0', '::']);

export function isLoopbackClientIp(clientIp: string | null | undefined): boolean {
  return typeof clientIp === 'string' && LOOPBACK_CLIENT_IPS.has(clientIp);
}

export function isRemoteListenHost(listenHost: string | null | undefined): boolean {
  return typeof listenHost === 'string' && REMOTE_LISTEN_HOSTS.has(listenHost);
}

function isLocalOnlyListenHost(listenHost: string | null | undefined): boolean {
  return typeof listenHost === 'string' && LOCAL_ONLY_LISTEN_HOSTS.has(listenHost);
}

export function allowsLocalhostTokenBypass(input: {
  clientIp: string | null | undefined;
  listenHost: string | null | undefined;
}): boolean {
  return isLoopbackClientIp(input.clientIp) && isLocalOnlyListenHost(input.listenHost);
}
