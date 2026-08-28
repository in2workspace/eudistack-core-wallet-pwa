import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isLegalDocumentId } from '../models/legal-document.model';

/**
 * ES-02 — fail-closed: a docId outside the closed catalogue NEVER reaches the
 * page, so an asset URL is never composed from it.
 * Returns a UrlTree (not navigate()) to avoid a double-navigation race.
 */
export const legalDocumentGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const raw = route.paramMap.get('docId');
  return isLegalDocumentId(raw) ? true : router.createUrlTree(['/tabs/about']);
};
