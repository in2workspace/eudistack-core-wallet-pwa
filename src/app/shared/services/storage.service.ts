import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private ready: Promise<Storage> | null = null;

  public constructor(private storage: Storage) {}

  public async set(llave: string, value: unknown) {
    const db = await this.db();
    await db.set(llave, value);
  }

  public async findAll() {
    const db = await this.db();
    const items: string[] = [];
    const size = await db.length();
    for (let i = 0; i < size; i++) {
      const val = await db.get(i.toString());
      items.push(val ?? '');
    }
    return items;
  }

  public async get(key: string): Promise<string> {
    const db = await this.db();
    return db.get(key);
  }

  public async remove(key: string) {
    const db = await this.db();
    return db.remove(key);
  }

  /**
   * The Ionic storage must be created before its first use. It is created lazily and once: every
   * operation awaits the same promise, so a call made right after startup waits for the storage
   * instead of being silently dropped (`set`) or failing (`get`/`remove`). A failed creation is
   * not cached, so the next operation tries again.
   */
  private db(): Promise<Storage> {
    this.ready ??= this.storage.create().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }
}
