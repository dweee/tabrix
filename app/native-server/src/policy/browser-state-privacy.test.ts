import { describe, expect, test } from '@jest/globals';
import {
  allowsPersonalBrowserStateStorage,
  summarizeBrowserObjectFactsForPrivacy,
  summarizeBrowserRouteForPrivacy,
} from './browser-state-privacy';

describe('browser state privacy policy', () => {
  test('requires explicit user authorized redaction state for personal state storage', () => {
    expect(allowsPersonalBrowserStateStorage('user_authorized')).toBe(true);
    expect(allowsPersonalBrowserStateStorage('redacted')).toBe(false);
    expect(allowsPersonalBrowserStateStorage(null)).toBe(false);
  });

  test('drops query strings and fragments from web routes by default', () => {
    expect(
      summarizeBrowserRouteForPrivacy(
        'https://example.test/search?q=private-token&access_token=real-secret#/account',
        { allowPersonalBrowserStateStorage: false },
      ),
    ).toBe('https://example.test/search');
  });

  test('preserves complete routes only after explicit authorization', () => {
    const route = 'https://example.test/search?q=private-token#/account';
    expect(summarizeBrowserRouteForPrivacy(route, { allowPersonalBrowserStateStorage: true })).toBe(
      route,
    );
  });

  test('does not expose local file paths by default', () => {
    expect(
      summarizeBrowserRouteForPrivacy('file:///C:/Users/Alice/Secrets/report.html', {
        allowPersonalBrowserStateStorage: false,
      }),
    ).toBeNull();
    expect(
      summarizeBrowserRouteForPrivacy('C:\\Users\\Alice\\Secrets\\report.html', {
        allowPersonalBrowserStateStorage: false,
      }),
    ).toBeNull();
  });

  test('sanitizes route facts without dropping non-route facts', () => {
    const facts = summarizeBrowserObjectFactsForPrivacy(
      {
        titleSummary: 'Search results',
        host: 'example.test',
        currentRoute: 'https://example.test/search?q=private-token#/account',
      },
      { allowPersonalBrowserStateStorage: false },
    );
    expect(facts).toEqual({
      titleSummary: 'Search results',
      host: 'example.test',
      currentRoute: 'https://example.test/search',
    });
  });
});
