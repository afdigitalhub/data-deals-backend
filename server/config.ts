// Central configuration. Every secret comes from environment variables — never from code.
const env = process.env;

const nodeEnv = env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const publicBaseUrl = (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');

export const config = {
  nodeEnv,
  isProduction,
  isTest,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || '',
  publicBaseUrl,
  secureCookies: publicBaseUrl.startsWith('https://'),
  appSecret: env.APP_SECRET || (isProduction ? '' : 'dev-only-insecure-secret-change-me'),
  extraAllowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  logLevel: env.LOG_LEVEL || (isTest ? 'error' : 'info'),
};

export function assertProductionConfig(): string[] {
  const problems: string[] = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is not set');
  if (config.isProduction && (!config.appSecret || config.appSecret.length < 32)) problems.push('APP_SECRET must be set to a random value of at least 32 characters');
  return problems;
}
