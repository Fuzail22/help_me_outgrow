import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export type Handler = (req: Request, res: Response) => Promise<unknown>;
export const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(422, 'validation_failed', r.error.issues[0]?.message ?? 'Request body is invalid', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}
