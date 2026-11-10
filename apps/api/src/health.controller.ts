import { Controller, Get } from '@nestjs/common';
import { Public } from './http/context';
import { PrismaService } from './infra/prisma.service';
import { redis } from './infra/redis';

@Controller()
@Public()
export class HealthController {
  constructor(private prisma: PrismaService) {}
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    await redis().ping();
    return { ok: true, service: 'domma-mart-api' };
  }
}
