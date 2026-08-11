// DOMAIN — no imports from @angular/*, rxjs, @ionic/* or @ngx-translate/*.

export interface OssLicense {
  readonly name: string;
  readonly version: string;
  /** 'UNKNOWN' is a valid value, not a generation failure (AD-3). */
  readonly license: string;
  readonly repository: string | null;
}

export interface OssLicensesManifest {
  readonly generatedAt: string;
  readonly packages: readonly OssLicense[];
}
