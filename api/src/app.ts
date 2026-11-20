import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Ctx } from './context.js';
import { HttpError } from './http.js';
import { PlatformError } from './platform.js';
import { authRoutes } from './routes/auth.js';
import { enrolmentRoutes } from './routes/enrolments.js';

export function createApp(ctx: Ctx, opts: { extra?: (api: express.Router) => void } = {}) {
  const { config } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Payment webhooks are verified over the exact bytes received, so keep them.
  app.use(express.json({ limit: '64kb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

  // The app is served from another origin (outgrow.htsta.com) than this api (api.outgrow.htsta.com).
  // Same site, so the Lax cookie is sent; browsers still need explicit CORS permission for credentials.
  app.use((req, res, next) => {
    if (req.header('origin') === config.appOrigin) {
      res.set({ 'Access-Control-Allow-Origin': config.appOrigin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' });
      if (req.method === 'OPTIONS') {
        res.set({ 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,x-admin', 'Access-Control-Max-Age': '600' });
        return res.status(204).end();
      }
    }
    next();
  });

  // The session cookie is SameSite=Lax; state-changing requests must also come from our own origin.
  // (Server-to-server calls such as payment webhooks send no Origin header and carry their own signature.)
  app.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.header('origin');
      if (origin && origin !== config.appOrigin) return next(new HttpError(403, 'bad_origin', 'Cross-site request refused'));
    }
    next();
  });

  const api = express.Router();
  authRoutes(ctx, api);
  enrolmentRoutes(ctx, api);
  opts.extra?.(api);
  app.use(api);

  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such route' } }));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof PlatformError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof z.ZodError) return res.status(422).json({ error: { code: 'validation_failed', message: 'Request body is invalid' } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'Body is not valid JSON' } });
    ctx.log({ level: 'error', msg: 'unhandled', error: String(err?.stack ?? err) });
    res.status(502).json({ error: { code: 'upstream_failed', message: 'Something went wrong; please try again' } });
  });
  return app;
}
