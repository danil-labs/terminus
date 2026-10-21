// `app.json` es la configuración; esto solo agrega la base del navegador al
// compilar la versión web (`/terminus/m`, la fija `apps/desktop/scripts/web-mobile.mjs`).
module.exports = ({ config }) => {
  const base = process.env.TERMINUS_MOBILE_WEB_BASE;
  return base ? { ...config, experiments: { ...config.experiments, baseUrl: base } } : config;
};
