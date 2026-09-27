import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// Preserve the existing CORS normalization without changing the guest mutation guard.
function normalizeOrigin(origin?: string): string {
  if (!origin) return '';
  const cleaned = origin
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
  return cleaned.endsWith('/') ? cleaned.slice(0, -1) : cleaned;
}

export function configureCors(
  app: INestApplication,
  corsOrigins = process.env.CORS_ORIGINS || '',
  demoAllowedOrigin = process.env.DEMO_ALLOWED_ORIGIN,
) {
  const allowedOrigins = corsOrigins
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  const demoOrigin = normalizeOrigin(demoAllowedOrigin);
  if (demoOrigin && !allowedOrigins.includes(demoOrigin)) {
    allowedOrigins.push(demoOrigin);
  }
  const isAllowed = (origin?: string) =>
    !origin || allowedOrigins.includes(normalizeOrigin(origin));

  // An error passed from cors's origin callback is handled as HTTP 500 by
  // Express. Deny explicitly before CORS runs, without echoing the Origin.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Vary', 'Origin');
    if (!isAllowed(req.headers.origin)) {
      return res.status(403).json({
        statusCode: 403,
        message: 'Origin is not allowed',
      });
    }
    next();
  });

  app.enableCors({
    origin: (origin, cb) => cb(null, isAllowed(origin)),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders:
      'Content-Type, Authorization, X-Requested-With, Accept, X-Demo-CSRF, X-Correlation-ID',
    credentials: true,
    optionsSuccessStatus: 204,
    exposedHeaders: 'Content-Disposition',
  });
}
