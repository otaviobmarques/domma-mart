import { z } from 'zod';
import { AppError } from '../common/errors';

/** Validação de entrada com schemas (seção 11.5). */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] = i.message;
    throw new AppError('VALIDATION_ERROR', { fields });
  }
  return r.data;
}
export { z };
