export interface Env {
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET', 'GOOGLE_CLIENT_ID'];
  const missing = required.filter((key) => !raw[key]);
  if (missing.length) {
    throw new Error(`Eksik ortam değişkenleri: ${missing.join(', ')}`);
  }
  if (String(raw.JWT_SECRET).length < 16) {
    throw new Error('JWT_SECRET en az 16 karakter olmalı');
  }
  return {
    PORT: Number(raw.PORT ?? 3003),
    DB_HOST: String(raw.DB_HOST),
    DB_PORT: Number(raw.DB_PORT ?? 5432),
    DB_USER: String(raw.DB_USER),
    DB_PASSWORD: String(raw.DB_PASSWORD),
    DB_NAME: String(raw.DB_NAME),
    JWT_SECRET: String(raw.JWT_SECRET),
    JWT_EXPIRES_IN: String(raw.JWT_EXPIRES_IN ?? '1d'),
    GOOGLE_CLIENT_ID: String(raw.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: raw.GOOGLE_CLIENT_SECRET ? String(raw.GOOGLE_CLIENT_SECRET) : undefined,
  };
}
