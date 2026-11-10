import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Erros no formato RFC 7807 (application/problem+json), sem detalhes técnicos (seção 9.1/23). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private log = new Logger('Error');
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let body: any = { type: 'about:blank', code: 'INTERNAL_ERROR', title: 'Algo deu errado do nosso lado. Tente de novo em instantes.', status: 500 };
    if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse();
      body = typeof r === 'object' && (r as any).code ? r : { type: 'about:blank', code: status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', title: status === 404 ? 'Não encontramos o que você procurou.' : 'Confira os campos destacados.', status };
    } else {
      this.log.error((err as Error)?.stack || String(err));
    }
    res.status(status).type('application/problem+json').send(JSON.stringify(body));
  }
}
