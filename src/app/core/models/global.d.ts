// src/types/global.d.ts

interface Window {
    env: {
      server_url?: string;
      websocket_url?: string;

      logs_enabled?: string;
      wallet_mode?: string;
      preferred_grant?: string;
      oid4vci_redirect_uri?: string;
      wia?: string;
      wia_instance_key_jwk?: string;
    };
  }

  // --- EUD-142: on-device Translator API (Chrome 138+ / Edge 148+ desktop) ---
  // Experimental browser API, not yet part of TypeScript's DOM lib. Ambient
  // declaration scoped to what BrowserTranslatorEngineAdapter actually uses.
  // Source: https://developer.chrome.com/docs/ai/translator-api (consulted 2026-08-04).

  interface TranslatorLanguagePair {
    sourceLanguage: string;
    targetLanguage: string;
  }

  interface TranslatorDownloadProgressEvent {
    readonly loaded: number;
    readonly total: number;
  }

  // Deliberately not `extends EventTarget`: EventTarget's generic
  // `addEventListener` overload is incompatible with the narrower,
  // single-event-type signature this ambient type declares.
  interface TranslatorCreateMonitor {
    addEventListener(
      type: 'downloadprogress',
      listener: (event: TranslatorDownloadProgressEvent) => void,
    ): void;
  }

  interface TranslatorCreateOptions extends TranslatorLanguagePair {
    monitor?: (monitor: TranslatorCreateMonitor) => void;
  }

  interface TranslatorInstance {
    translate(text: string): Promise<string>;
    destroy(): void;
  }

  declare const Translator: {
    availability(pair: TranslatorLanguagePair): Promise<'unavailable' | 'downloadable' | 'available'>;
    create(options: TranslatorCreateOptions): Promise<TranslatorInstance>;
  };
