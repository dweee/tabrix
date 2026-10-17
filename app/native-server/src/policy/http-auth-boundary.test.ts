import { describe, expect, test } from '@jest/globals';
import {
  allowsLocalhostTokenBypass,
  isLoopbackClientIp,
  isRemoteListenHost,
} from './http-auth-boundary';

describe('HTTP auth boundary policy', () => {
  test('recognizes loopback client IPs only', () => {
    expect(isLoopbackClientIp('127.0.0.1')).toBe(true);
    expect(isLoopbackClientIp('::1')).toBe(true);
    expect(isLoopbackClientIp('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackClientIp('192.168.1.50')).toBe(false);
  });

  test('treats wildcard listen hosts as remote-exposed', () => {
    expect(isRemoteListenHost('0.0.0.0')).toBe(true);
    expect(isRemoteListenHost('::')).toBe(true);
    expect(isRemoteListenHost('127.0.0.1')).toBe(false);
    expect(isRemoteListenHost('localhost')).toBe(false);
  });

  test('allows localhost token bypass only for local-only listen hosts', () => {
    expect(allowsLocalhostTokenBypass({ clientIp: '127.0.0.1', listenHost: '127.0.0.1' })).toBe(
      true,
    );
    expect(allowsLocalhostTokenBypass({ clientIp: '::1', listenHost: 'localhost' })).toBe(true);
    expect(allowsLocalhostTokenBypass({ clientIp: '127.0.0.1', listenHost: '0.0.0.0' })).toBe(
      false,
    );
    expect(allowsLocalhostTokenBypass({ clientIp: '127.0.0.1', listenHost: '::' })).toBe(false);
    expect(allowsLocalhostTokenBypass({ clientIp: '127.0.0.1', listenHost: undefined })).toBe(
      false,
    );
    expect(allowsLocalhostTokenBypass({ clientIp: '192.168.1.50', listenHost: '127.0.0.1' })).toBe(
      false,
    );
  });
});
