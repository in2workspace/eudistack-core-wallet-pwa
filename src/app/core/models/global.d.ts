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
  