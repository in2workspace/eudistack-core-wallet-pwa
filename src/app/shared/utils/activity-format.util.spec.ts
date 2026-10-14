import { ActivityEntry } from 'src/app/core/models/activity.model';
import { formatAbsoluteTime, formatCounterparty, resolveCounterpartyName } from './activity-format.util';

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

describe('resolveCounterpartyName', () => {
  it('prefers the verifier client_name over any technical identifier', () => {
    const name = resolveCounterpartyName({
      clientName: 'DOME Marketplace',
      redirectUri: 'https://verifier.example.com/cb',
      clientId: 'x509_hash:abc123',
    });

    expect(name).toBe('DOME Marketplace');
  });

  it('trims the client_name', () => {
    expect(resolveCounterpartyName({ clientName: '  Acme Corp  ' })).toBe('Acme Corp');
  });

  it('falls back to the redirect URI hostname when client_name is empty', () => {
    const name = resolveCounterpartyName({ clientName: '   ', redirectUri: 'https://verifier.example.com/cb', clientId: 'x509_hash:abc123' });

    expect(name).toBe('verifier.example.com');
  });

  it('strips a leading www. from the hostname', () => {
    expect(resolveCounterpartyName({ redirectUri: 'https://www.verifier.example.com/cb' })).toBe('verifier.example.com');
  });

  it('falls back to a truncated did: client_id when there is no usable redirect URI', () => {
    const name = resolveCounterpartyName({
      redirectUri: 'not a url',
      clientId: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktQ',
    });

    expect(name).toBe('did:key:z6Mk…sdvktQ');
  });

  it('returns an empty string when nothing is available', () => {
    expect(resolveCounterpartyName({})).toBe('');
  });

  it('caps a long client_name at 30 characters with an ellipsis', () => {
    const name = resolveCounterpartyName({ clientName: 'A'.repeat(50) });

    expect(name).toBe(`${'A'.repeat(29)}…`);
  });

  it('keeps a client_name of exactly 30 characters untouched', () => {
    expect(resolveCounterpartyName({ clientName: 'B'.repeat(30) })).toBe('B'.repeat(30));
  });

  it('caps a very long hostname', () => {
    const name = resolveCounterpartyName({ redirectUri: 'https://very-long-verifier-name.example-domain.com/cb' });

    expect(name).toHaveLength(30);
    expect(name.endsWith('…')).toBe(true);
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
