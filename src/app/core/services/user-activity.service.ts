import { Injectable } from '@angular/core';
import { fromEvent, merge, Observable } from 'rxjs';
import { map, share, throttleTime } from 'rxjs/operators';

/** User interactions that count as activity for the session (FR-19). */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** One activity notice per second is enough to decide whether to renew a 5-minute token. */
const ACTIVITY_THROTTLE_MS = 1_000;

/**
 * Emits when the user interacts with the Wallet App. The server session is
 * renewed only while there is activity (design §2.4): with none, the access
 * token is left to expire and the service applies its inactivity limit.
 */
@Injectable({ providedIn: 'root' })
export class UserActivityService {
  readonly activity$: Observable<void> = merge(
    ...ACTIVITY_EVENTS.map(type => fromEvent(document, type, { capture: true, passive: true }))
  ).pipe(
    throttleTime(ACTIVITY_THROTTLE_MS),
    map(() => undefined),
    share()
  );
}
