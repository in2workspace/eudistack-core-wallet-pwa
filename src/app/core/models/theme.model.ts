export interface Theme {
  branding: {
    name: string;
    primaryColor: string;
    primaryContrastColor: string;
    secondaryColor: string;
    secondaryContrastColor: string;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    pwaIconUrl: string | null;
  };
  content: {
    links: { label: string; url: string }[];
    footer: string | null;
  };
  i18n: {
    defaultLang: string;
    available: string[];
  };
}
