export function getConfig(env = process.env) {
  const port = Number(env.PORT || 3001);
  const base = (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const origin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:5173';
  return { port, base, origin: origin.replace(/\/$/, ''), callback: env.GOOGLE_REDIRECT_URI || `${base}/api/auth/google/callback` };
}
