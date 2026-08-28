import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { OssLicense, OssLicensesManifest } from '../models/oss-license.model';

/**
 * AC-05 / ES-03 — loads the build-generated OSS licenses manifest.
 * Degrades to an empty list (never throws) when the artifact is missing or
 * unreadable — the page renders an explanatory empty state instead (ES-03).
 */
@Injectable({ providedIn: 'root' })
export class OssLicenseService {
  private readonly http = inject(HttpClient);
  private readonly telemetry = inject(TelemetryService);

  load(): Observable<readonly OssLicense[]> {
    return this.http.get<OssLicensesManifest>('assets/legal/oss-licenses.json').pipe(
      map((manifest) => manifest.packages ?? []),
      catchError(() => {
        this.telemetry.track('about_oss_licenses_unavailable');
        return of([] as readonly OssLicense[]);
      })
    );
  }
}
