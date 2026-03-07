// src/types/global.d.ts

interface Window {
    env: {
      server_url?: string;
      websocket_url?: string;

      logs_enabled?: string;
      primary: string;
      primary_contrast: string;
      secondary: string;
      secondary_contrast: string;
      assets_base_url?: string;
      logo_path?: string;
      favicon_path?: string;
      default_lang: string;
      wallet_mode?: string;
      preferred_grant?: string;
      oid4vci_redirect_uri?: string;
      wia?: string;
      wia_instance_key_jwk?: string;
    };
  }
  