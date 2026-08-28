import { ActivityEntry } from 'src/app/core/models/activity.model';
import { formatAbsoluteTime, formatCounterparty } from './activity-format.util';

function buildEntry(counterparty: string): ActivityEntry {
  return {
    id: '1',
    type: 'presented',
    credentialName: 'Test Credential',
    counterparty,
    timestamp: Date.now(),
  };
}

describe('formatCounterparty', () => {
  it('returns an empty string for an empty counterparty', () => {
    expect(formatCounterparty(buildEntry(''))).toBe('');
  });

  it('returns an empty string for a whitespace-only counterparty', () => {
    expect(formatCounterparty(buildEntry('   '))).toBe('');
  });

  it('reduces a URL counterparty to its hostname', () => {
    expect(formatCounterparty(buildEntry('https://verifier.example.com/callback'))).toBe('verifier.example.com');
  });

  it('truncates a long did: URI', () => {
    const did = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktQ';
    expect(formatCounterparty(buildEntry(did))).toBe('did:key:z6Mk…sdvktQ');
  });

  it('returns a short did: URI unchanged', () => {
    const did = 'did:key:short';
    expect(formatCounterparty(buildEntry(did))).toBe(did);
  });

  it('returns non-URL text as-is', () => {
    expect(formatCounterparty(buildEntry('Acme Corp'))).toBe('Acme Corp');
  });
});

describe('formatAbsoluteTime', () => {
  const timestamp = new Date('2026-03-05T14:30:00Z').getTime();

  it('formats using the default es-ES locale', () => {
    const expected = new Date(timestamp).toLocaleString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatAbsoluteTime(timestamp)).toBe(expected);
  });

  it('accepts a custom locale', () => {
    const expected = new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatAbsoluteTime(timestamp, 'en-US')).toBe(expected);
  });
});
