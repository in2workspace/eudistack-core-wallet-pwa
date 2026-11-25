import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';
import { UrlResolverService } from './url-resolver.service';
import { authProblemType } from '../models/error/WalletAuthError';
import { DeviceType } from '../utils/device-proposal';

/** A device of the account: a Wallet Instance (EUD-15 `annex/openapi.yaml`, `WalletInstance`). */
export interface WalletInstance {
  id: string;
  displayName: string;
  deviceType: DeviceType;
  createdAt: string;
  lastUsedAt: string | null;
  /** The device of this session. */
  current: boolean;
}

/**
 * State of the session with respect to its device:
 * - `bound`: the session is bound to the active device this Wallet App remembers.
 * - `unregistered`: this Wallet App remembers no active device of the account; the user registers one.
 * - `unavailable`: the binding failed for a temporary reason (offline, 5xx); retried on `instance_required`.
 */
export type DeviceState = 'bound' | 'unregistered' | 'unavailable';

export const INSTANCE_REQUIRED = 'instance_required';
const INSTANCE_NOT_FOUND = 'instance_not_found';
const INSTANCE_REVOKED = 'instance_revoked';

const DB_NAME = 'wallet-instance';
const STORE_NAME = 'wallet-instance';
const DB_VERSION = 1;
const REGISTRATION_LOCK_PREFIX = 'eudistack-wallet-instance-registration:';

interface StoredInstance {
  instanceId: string;
}

interface WebLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** Whether an error is the 403 `instance_required` of the Wallet Unit Service (EUD-15 AD-3). */
export function isInstanceRequired(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 403 && authProblemType(err) === INSTANCE_REQUIRED;
}

/**
 * The Wallet Instance of this Wallet App (EUD-15 design §2.2). It remembers only the identifier of its instance,
 * per account, in IndexedDB (store `wallet-instance`, key `sub` of the account, never the email; value
 * `{ instanceId }`): no keys, no name. After a session is opened it binds the session to that instance, or tells
 * the caller that the device has to be registered; and it calls the API of "Dispositivos".
 */
@Injectable({ providedIn: 'root' })
export class WalletInstanceService {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);

  private get base(): string { return `${this.urlResolver.serverUrl()}/api/v1/wallet-instances`; }

  /**
   * Binds the session to the instance this Wallet App remembers for the account, without any step for the user
   * (FR-05). A revoked or unknown instance is forgotten (FR-07): the device has to be registered again.
   */
  public async bindRemembered(accountId: string): Promise<DeviceState> {
    const instanceId = await this.rememberedInstance(accountId);
    if (!instanceId) {
      return 'unregistered';
    }
    try {
      await firstValueFrom(this.http.put<WalletInstance>(`${this.base}/current`, { instanceId }));
      return 'bound';
    } catch (err) {
      const type = authProblemType(err);
      if (type === INSTANCE_NOT_FOUND || type === INSTANCE_REVOKED) {
        await this.forget(accountId);
        return 'unregistered';
      }
      console.warn('[WalletInstanceService] Could not bind the session to its device', err);
      return 'unavailable';
    }
  }

  /**
   * Registers this Wallet App as a new device of the account and binds the session to it (FR-01, FR-03), then
   * remembers it. Registrations of the same account are serialized across tabs (design §7): a tab that waited
   * for the lock first binds to the device another tab has just registered, instead of registering a second one.
   */
  public register(accountId: string, displayName: string, deviceType: DeviceType): Promise<WalletInstance> {
    const run = async () => {
      const registeredMeanwhile = await this.bindRememberedInstance(accountId);
      if (registeredMeanwhile) {
        return registeredMeanwhile;
      }
      const instance = await firstValueFrom(
        this.http.post<WalletInstance>(this.base, { displayName: displayName.trim(), deviceType })
      );
      await this.remember(accountId, instance.id);
      void this.requestPersistentStorage();
      return instance;
    };
    const locks = (navigator as Navigator & { locks?: WebLocks }).locks;
    return locks ? locks.request(REGISTRATION_LOCK_PREFIX + accountId, run) : run();
  }

  public list(): Observable<WalletInstance[]> {
    return this.http.get<WalletInstance[]>(this.base);
  }

  public rename(id: string, displayName: string): Observable<WalletInstance> {
    return this.http.patch<WalletInstance>(`${this.base}/${encodeURIComponent(id)}`, { displayName: displayName.trim() });
  }

  public revoke(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${encodeURIComponent(id)}`);
  }

  /** Binds the session to the remembered device and returns it, or `null` if there is none or it cannot be bound. */
  private async bindRememberedInstance(accountId: string): Promise<WalletInstance | null> {
    const instanceId = await this.rememberedInstance(accountId);
    if (!instanceId) {
      return null;
    }
    try {
      return await firstValueFrom(this.http.put<WalletInstance>(`${this.base}/current`, { instanceId }));
    } catch {
      return null;
    }
  }

  /** Forgets the instance of the account (revoked, unknown, or this device revoked by the user). */
  public async forget(accountId: string): Promise<void> {
    try {
      await this.withStore('readwrite', store => store.delete(accountId));
    } catch (err) {
      console.warn('[WalletInstanceService] Could not forget the device', err);
    }
  }

  /** The instance this Wallet App remembers for the account, or `null`. */
  public async rememberedInstance(accountId: string): Promise<string | null> {
    try {
      const stored = await this.withStore<StoredInstance | undefined>('readonly', store => store.get(accountId));
      return stored?.instanceId ?? null;
    } catch (err) {
      console.warn('[WalletInstanceService] Could not read the device', err);
      return null;
    }
  }

  private async remember(accountId: string, instanceId: string): Promise<void> {
    try {
      await this.withStore('readwrite', store => store.put({ instanceId } satisfies StoredInstance, accountId));
    } catch (err) {
      // Not fatal: the next session registers the device again.
      console.warn('[WalletInstanceService] Could not remember the device', err);
    }
  }

  /**
   * Asks once, right after registering, that the browser keep this origin's data, so the identifier survives
   * automatic clean-ups (design §2.2). Never waits for nor depends on the answer.
   */
  private async requestPersistentStorage(): Promise<void> {
    try {
      const storage = navigator.storage;
      if (storage?.persisted && storage.persist && !(await storage.persisted())) {
        await storage.persist();
      }
    } catch {
      // Best effort only.
    }
  }

  private withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE_NAME)) {
          open.result.createObjectStore(STORE_NAME);
        }
      };
      open.onerror = () => reject(open.error ?? new Error('wallet-instance store could not be opened'));
      // Another connection with an older version: never wait forever (registration holds a cross-tab lock).
      open.onblocked = () => reject(new Error('wallet-instance store blocked'));
      open.onsuccess = () => {
        const db = open.result;
        try {
          const tx = db.transaction(STORE_NAME, mode);
          const request = operation(tx.objectStore(STORE_NAME));
          tx.oncomplete = () => {
            db.close();
            resolve(request.result as T);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error ?? new Error('wallet-instance transaction failed'));
          };
          // A transaction can abort without an error event (QuotaExceededError).
          tx.onabort = () => {
            db.close();
            reject(tx.error ?? new Error('wallet-instance transaction aborted'));
          };
        } catch (err) {
          db.close();
          reject(err);
        }
      };
    });
  }
}
