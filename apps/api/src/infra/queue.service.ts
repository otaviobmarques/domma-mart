import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Queue, Worker, Job, JobsOptions } from 'bullmq';
import { newRedis } from './redis';

type Handler = (data: any, job: Job) => Promise<void>;

/** Filas BullMQ (seção 6.1): webhooks, régua de recuperação, e-mails, expiração de Pix, conciliação. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private log = new Logger('Queue');
  private queue = new Queue('domma', { connection: newRedis() });
  private handlers = new Map<string, Handler>();
  private worker?: Worker;

  register(name: string, h: Handler) { this.handlers.set(name, h); }

  async add(name: string, data: unknown, opts: JobsOptions = {}) {
    return this.queue.add(name, data, { removeOnComplete: 1000, removeOnFail: 5000, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, ...opts });
  }
  async addDelayed(name: string, data: unknown, delayMs: number, jobId?: string) {
    return this.add(name, data, { delay: Math.max(0, delayMs), jobId });
  }
  async repeat(name: string, pattern: string) {
    await this.queue.upsertJobScheduler(name, { pattern, tz: 'America/Sao_Paulo' }, { name, data: {} });
  }

  startWorker() {
    if (this.worker) return;
    this.worker = new Worker('domma', async (job) => {
      const h = this.handlers.get(job.name);
      if (!h) { this.log.warn(`sem handler para ${job.name}`); return; }
      await h(job.data, job);
    }, { connection: newRedis(), concurrency: 10 });
    this.worker.on('failed', (job, err) => this.log.error(`job ${job?.name} falhou: ${err.message}`));
  }

  async onModuleDestroy() { await this.worker?.close(); await this.queue.close(); }
}
