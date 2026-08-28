import { ActivityEntry, ActivityType } from '../models/activity.model';
import { ActivityExportLabels, ActivityExportService } from './activity-export.service';

const CSV_LINE_BREAK = '\r\n';

const LABELS: ActivityExportLabels = {
  headers: {
    type: 'Tipo',
    credentialName: 'Credencial',
    counterparty: 'Contraparte',
    timestamp: 'Fecha',
    details: 'Detalle',
  },
  types: {
    issued: 'Credencial recibida',
    presented: 'Credencial presentada',
    deleted: 'Credencial eliminada',
  },
};

/** Deliberately out of chronological/id order, to prove buildCsv never re-sorts (AD-2/AD-4). */
const ENTRIES: ActivityEntry[] = [
  { id: 'internal-uuid-2', type: 'presented', credentialName: 'Cred B', counterparty: 'Verifier B', timestamp: 2000 },
  { id: 'internal-uuid-4', type: 'deleted', credentialName: 'Cred D', counterparty: '', timestamp: 4000 },
  { id: 'internal-uuid-1', type: 'issued', credentialName: 'Cred A', counterparty: 'Issuer A', timestamp: 1000 },
];

function stripBom(csv: string): string {
  return csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
}

function parseLines(csv: string): string[] {
  return stripBom(csv).split(CSV_LINE_BREAK);
}

describe('ActivityExportService.buildCsv', () => {
  let service: ActivityExportService;

  beforeEach(() => {
    service = new ActivityExportService();
  });

  // --- AC-02 ---------------------------------------------------------------

  it('AC-02: emits a header row with the 5 allow-listed columns, in labels order', () => {
    const csv = service.buildCsv([], LABELS);
    const lines = parseLines(csv);

    expect(lines[0]).toBe('Tipo,Credencial,Contraparte,Fecha,Detalle');
  });

  it('AC-02: emits exactly one data row per entry', () => {
    const csv = service.buildCsv(ENTRIES, LABELS);
    const lines = parseLines(csv);

    expect(lines.length).toBe(ENTRIES.length + 1); // header + N
  });

  it('AC-02: preserves the input order of entries, without re-sorting', () => {
    const csv = service.buildCsv(ENTRIES, LABELS);
    const [, ...dataLines] = parseLines(csv);

    // ENTRIES is deliberately not chronological (2000, 4000, 1000) — output must follow it verbatim.
    expect(dataLines.map((line) => line.split(',')[1])).toEqual(['Cred B', 'Cred D', 'Cred A']);
  });

  it('AC-02: serializes the timestamp as ISO 8601 (unambiguous, non-locale-dependent)', () => {
    const csv = service.buildCsv([ENTRIES[0]], LABELS);
    const [, dataLine] = parseLines(csv);

    expect(dataLine.split(',')[3]).toBe(new Date(2000).toISOString());
  });

  it('AC-02: localizes the "type" column via labels.types', () => {
    const csv = service.buildCsv(ENTRIES, LABELS);
    const [, ...dataLines] = parseLines(csv);

    expect(dataLines.map((line) => line.split(',')[0])).toEqual([
      'Credencial presentada',
      'Credencial eliminada',
      'Credencial recibida',
    ]);
  });

  // --- AC-03 -----------------------------------------------------------

  it('AC-03: maps 1:1 with the input entries — no more, no fewer rows', () => {
    const csv = service.buildCsv([ENTRIES[0]], LABELS);
    const [, ...dataLines] = parseLines(csv);

    expect(dataLines.length).toBe(1);
    expect(dataLines[0]).toContain('Cred B');
  });

  it('AC-03: does not introduce data foreign to the entries passed in', () => {
    const csv = service.buildCsv([ENTRIES[2]], LABELS);

    expect(csv).not.toContain('Cred B');
    expect(csv).not.toContain('Cred D');
    expect(csv).toContain('Cred A');
  });

  // --- AC-04 -----------------------------------------------------------

  it('AC-04: excludes the internal storage id from every row', () => {
    const csv = service.buildCsv(ENTRIES, LABELS);

    expect(csv).not.toContain('internal-uuid-1');
    expect(csv).not.toContain('internal-uuid-2');
    expect(csv).not.toContain('internal-uuid-4');
  });

  it('AC-04: excludes fields outside the 5-column allow-list (e.g. sharedAttributes)', () => {
    const withSharedAttributes: ActivityEntry = {
      ...ENTRIES[0],
      sharedAttributes: ['given_name', 'family_name'],
    };
    const csv = service.buildCsv([withSharedAttributes], LABELS);

    expect(csv).not.toContain('given_name');
    expect(csv).not.toContain('family_name');
  });

  it('AC-04: every data row has exactly 5 columns', () => {
    const csv = service.buildCsv(ENTRIES, LABELS);
    const [, ...dataLines] = parseLines(csv);

    for (const line of dataLines) {
      expect(line.split(',').length).toBe(5);
    }
  });

  // --- EC-01 -----------------------------------------------------------

  it('EC-01: prefixes the content with a UTF-8 BOM', () => {
    const csv = service.buildCsv(ENTRIES, LABELS);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('EC-01: uses \\r\\n as the line separator', () => {
    const csv = service.buildCsv([ENTRIES[0]], LABELS);

    expect(stripBom(csv)).toBe(
      [
        'Tipo,Credencial,Contraparte,Fecha,Detalle',
        `Credencial presentada,Cred B,Verifier B,${new Date(2000).toISOString()},`,
      ].join(CSV_LINE_BREAK)
    );
  });

  it('EC-01: quotes a field containing a comma', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], credentialName: 'Cred, with comma' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain('"Cred, with comma"');
  });

  it('EC-01: quotes a field containing a double quote and doubles the internal quote', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], counterparty: 'Verifier "Trusted" Inc.' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain('"Verifier ""Trusted"" Inc."');
  });

  it('EC-01: quotes a field containing a line break (the break itself is preserved inside the quotes)', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], details: 'line one\nline two' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain('"line one\nline two"');
  });

  it('EC-01: leaves plain fields (no special characters) unquoted', () => {
    const csv = service.buildCsv([ENTRIES[0]], LABELS);

    expect(csv).toContain('Cred B');
    expect(csv).not.toContain('"Cred B"');
  });

  // --- EC-02 -----------------------------------------------------------

  it('EC-02: prefixes a credentialName starting with "=" with a single quote before RFC 4180 escaping', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], credentialName: '=SUM(A1:A9)' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain("'=SUM(A1:A9)");
  });

  it('EC-02: prefixes a counterparty starting with "+" with a single quote', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], counterparty: '+1234=cmd' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain("'+1234=cmd");
  });

  it('EC-02: prefixes a details value starting with "-" with a single quote', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], details: '-2+3+cmd|calc' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain("'-2+3+cmd|calc");
  });

  it('EC-02: prefixes a value starting with "@" with a single quote', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], credentialName: '@SUM(1+1)' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain("'@SUM(1+1)");
  });

  it('EC-02: prefixes a value starting with a TAB character with a single quote', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], credentialName: '\tmalicious' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain("'\tmalicious");
  });

  it('EC-02: prefixes a value starting with a CR character (also quoted per RFC 4180)', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], credentialName: '\rmalicious' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain('"\'\rmalicious"');
  });

  it('EC-02: does not alter values that do not start with a formula-trigger character', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], credentialName: 'Safe credential = value' };
    const csv = service.buildCsv([entry], LABELS);

    expect(csv).toContain('Safe credential = value');
    expect(csv).not.toContain("'Safe credential");
  });

  it('EC-02: only neutralizes the 3 free-text columns, not the localized "type" column', () => {
    const labelsWithTriggerType: ActivityExportLabels = {
      ...LABELS,
      types: { ...LABELS.types, issued: '=Credencial recibida' },
    };
    const csv = service.buildCsv([ENTRIES[2]], labelsWithTriggerType);

    expect(csv).toContain('=Credencial recibida');
    expect(csv).not.toContain("'=Credencial recibida");
  });

  // --- EC-03 (perf-oriented) ---------------------------------------------

  it('EC-03: serializes 200 entries (MAX_ENTRIES) plus header in under 1s', () => {
    const largeEntries: ActivityEntry[] = Array.from({ length: 200 }, (_, i) => ({
      id: `id-${i}`,
      type: (['issued', 'presented', 'deleted'] as ActivityType[])[i % 3],
      credentialName: `Cred ${i}`,
      counterparty: `Party ${i}`,
      timestamp: i * 1000,
    }));

    const start = performance.now();
    const csv = service.buildCsv(largeEntries, LABELS);
    const elapsed = performance.now() - start;

    const lines = parseLines(csv);
    expect(lines.length).toBe(201); // header + 200
    expect(elapsed).toBeLessThan(1000);
  });

  // --- EC-04 -----------------------------------------------------------

  it('EC-04: an absent "details" field serializes to an empty cell, never "undefined"', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], details: undefined };
    const csv = service.buildCsv([entry], LABELS);
    const [, dataLine] = parseLines(csv);

    expect(dataLine.split(',')[4]).toBe('');
    expect(csv).not.toContain('undefined');
  });

  it('EC-04: an empty "counterparty" (e.g. "deleted" events) serializes to an empty cell, never "null"', () => {
    const entry: ActivityEntry = { ...ENTRIES[0], counterparty: null as unknown as string };
    const csv = service.buildCsv([entry], LABELS);
    const [, dataLine] = parseLines(csv);

    expect(dataLine.split(',')[2]).toBe('');
    expect(csv).not.toContain('null');
  });

  // --- ES-01 -----------------------------------------------------------

  it('ES-01: a "type" outside the known union serializes as its raw value, without throwing', () => {
    const malformed: ActivityEntry = { ...ENTRIES[0], type: 'archived' as unknown as ActivityType };

    expect(() => service.buildCsv([malformed], LABELS)).not.toThrow();
    const [, dataLine] = parseLines(service.buildCsv([malformed], LABELS));
    expect(dataLine.split(',')[0]).toBe('archived');
  });

  it('ES-01: a missing "type" serializes as an empty cell, without throwing', () => {
    const malformed: ActivityEntry = { ...ENTRIES[0], type: undefined as unknown as ActivityType };

    const [, dataLine] = parseLines(service.buildCsv([malformed], LABELS));
    expect(dataLine.split(',')[0]).toBe('');
  });

  it('ES-01: a malformed entry does not throw and does not abort the rest of the export', () => {
    const entries = [null as unknown as ActivityEntry, ENTRIES[2]];

    expect(() => service.buildCsv(entries, LABELS)).not.toThrow();
    const csv = service.buildCsv(entries, LABELS);
    const lines = parseLines(csv);

    expect(lines.length).toBe(3); // header + malformed row + valid row
    expect(csv).toContain('Cred A');
  });
});
