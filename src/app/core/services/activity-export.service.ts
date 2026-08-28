import { Injectable } from '@angular/core';
import { ActivityEntry, ActivityType } from '../models/activity.model';

const CSV_BOM = '\uFEFF';
const CSV_LINE_BREAK = '\r\n';

export interface ActivityExportHeaders {
  type: string;
  credentialName: string;
  counterparty: string;
  timestamp: string;
  details: string;
}

export interface ActivityExportLabels {
  headers: ActivityExportHeaders;
  types: Record<ActivityType, string>;
}

@Injectable({ providedIn: 'root' })
export class ActivityExportService {

  buildCsv(entries: ActivityEntry[], labels: ActivityExportLabels): string {
    const header = [
      labels.headers.type,
      labels.headers.credentialName,
      labels.headers.counterparty,
      labels.headers.timestamp,
      labels.headers.details,
    ];
    const rows = entries.map((entry) => this.buildRow(entry, labels));
    const lines = [header, ...rows].map((row) => row.map(escapeCsvField).join(','));
    return CSV_BOM + lines.join(CSV_LINE_BREAK);
  }

  triggerDownload(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    try {
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }

  buildFileName(now: Date): string {
    const date = now.toISOString().slice(0, 10);
    return `actividad-wallet-${date}.csv`;
  }

  private buildRow(entry: ActivityEntry, labels: ActivityExportLabels): string[] {
    try {
      return [
        toCell(labels.types[entry?.type as ActivityType] ?? entry?.type),
        neutralizeFormula(toCell(entry?.credentialName)),
        neutralizeFormula(toCell(entry?.counterparty)),
        safeIsoString(entry?.timestamp),
        neutralizeFormula(toCell(entry?.details)),
      ];
    } catch {
      return ['', '', '', '', ''];
    }
  }
}

function toCell(value: unknown): string {
  return String(value ?? '');
}

function safeIsoString(timestamp: unknown): string {
  const date = new Date(timestamp as string | number);
  return Number.isNaN(date.getTime()) ? toCell(timestamp) : date.toISOString();
}

function neutralizeFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
