import { describe, expect, it } from 'vitest';
import { desktopLockVersion } from './release-artifacts.mjs';

describe('release Cargo lock version on native checkouts', () => {
  const source = '[[package]]\nname = "other-package"\nversion = "9.9.9"\n\n[[package]]\nname = "opendicomviewer-desktop"\nversion = "0.1.0"\n';
  it('reads the application version with LF and Windows CRLF', () => {
    expect(desktopLockVersion(source)).toBe('0.1.0');
    expect(desktopLockVersion(source.replaceAll('\n', '\r\n'))).toBe('0.1.0');
  });
  it('does not substitute a different package version when the app is absent', () => {
    expect(desktopLockVersion(source.replace('opendicomviewer-desktop', 'another-app'))).toBeUndefined();
  });
});
