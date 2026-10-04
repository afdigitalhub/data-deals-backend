// Central configuration. Every secret comes from environment variables — never from code.
const env = process.env;

function bool(v: string | undefined, dflt = false): boolean {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

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
  // Used to sign guest order/ticket access links. Must be a long random value in production.
  appSecret: env.APP_SECRET || (isProduction ? '' : 'dev-only-insecure-secret-change-me'),
  extraAllowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  paystack: {
    secretKey: env.PAYSTACK_SECRET_KEY || '',
    baseUrl: env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  },
  // Test-only payment and supplier simulators. They refuse to run in production.
  fakePayments: !isProduction && bool(env.FAKE_PAYMENTS),
  supplierSandbox: !isProduction && bool(env.SUPPLIER_SANDBOX),
  remadata: {
    apiKey: env.REMADATA_API_KEY || '',
    baseUrl: env.REMADATA_API_BASE_URL || '',
  },
  // DataMart GH (https://www.datamartgh.shop/api-doc). Key lives only in Render's environment settings.
  datamart: {
    apiKey: env.DATAMART_API_KEY || '',
    apiSecret: env.DATAMART_API_SECRET || '', // optional "second secret" (X-API-Secret) if enabled in DataMart
    refPrefix: env.DATAMART_REF_PREFIX || '', // optional "reference rule" prefix if enabled in DataMart
    baseUrl: (env.DATAMART_API_BASE_URL || 'https://api.datamartgh.shop/api/developer').replace(/\/+$/, ''),
  },
  // Web push (phone notifications). Keys are generated once and stored only in Render's environment.
  push: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || '',
    allowAnyHost: isTest && bool(env.PUSH_ALLOW_ANY_HOST),
  },
  email: {
    resendApiKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || '',
  },
  workerEnabled: bool(env.WORKER_ENABLED, !isTest),
  logLevel: env.LOG_LEVEL || (isTest ? 'error' : 'info'),
};

export function paymentsMode(): 'live' | 'test' | 'fake' | 'not_configured' {
  if (config.fakePayments) return 'fake';
  const k = config.paystack.secretKey;
  if (k.startsWith('sk_live_')) return 'live';
  if (k.startsWith('sk_test_')) return 'test';
  return 'not_configured';
}

export function assertProductionConfig(): string[] {
  const problems: string[] = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is not set');
  if (config.isProduction && (!config.appSecret || config.appSecret.length < 32)) problems.push('APP_SECRET must be set to a random value of at least 32 characters');
  return problems;
}
