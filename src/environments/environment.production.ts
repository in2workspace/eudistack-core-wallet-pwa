// this file is the used when deploying (see Dockerfile);
// its values will be overwriten by env variables (see env.js & env.template.js)
export const environment = {
  production: true,
  server_url: window["env"]["server_url"] || "", // REQUIRED
  websocket_url: window["env"]["websocket_url"], // REQUIRED
  logs_enabled: window["env"]["logs_enabled"] === "true" || false, //OPTIONAL WITH fallback
  customizations:{  
    colors:{ 
      primary: window["env"]["primary"] || '#184BFF', //OPTIONAL WITH fallback
      primary_contrast: window["env"]["primary_contrast"] || '#ffffff', //OPTIONAL WITH fallback
      secondary: window["env"]["secondary"] || '#132153', //OPTIONAL WITH fallback
      secondary_contrast: window["env"]["secondary_contrast"] || '#00FF94' //OPTIONAL WITH fallback
    },
    assets: {
      // Base URL for images (REQUIRED)
      base_url: window["env"]["assets_base_url"],
      // Main app logo name, shown in the navbar. Points to "assets/logos/" (REQUIRED)
      logo_path: window["env"]["logo_path"],
      // App favicon. Points to "assets/icons/" (REQUIRED)
      favicon_path: window["env"]["favicon_path"]
    },
    default_lang: window["env"]["default_lang"] || "en", // OPTIONAL with fallback
  }
};
