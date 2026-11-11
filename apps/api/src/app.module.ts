import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaService } from './infra/prisma.service';
import { AuditService } from './infra/audit.service';
import { StorageService } from './infra/storage.service';
import { QueueService } from './infra/queue.service';
import { NotifyService } from './infra/notify.service';
import { AuthGuard } from './http/auth.guard';
import { ProblemFilter } from './http/problem.filter';
import { GATEWAY } from './modules/gateway/gateway.types';
import { PagarmeGateway } from './modules/gateway/pagarme.adapter';
import { SandboxGateway } from './modules/gateway/sandbox.adapter';
import { LedgerService } from './modules/ledger/ledger.service';
import { OrdersService } from './modules/orders/orders.service';
import { CheckoutService } from './modules/checkout/checkout.service';
import { CheckoutController } from './modules/checkout/checkout.controller';
import { WebhooksController, SandboxController } from './modules/webhooks/webhooks.controller';
import { JobsService } from './modules/jobs/jobs.service';
import { FinanceService } from './modules/finance/finance.service';
import { AuthController } from './modules/auth/auth.controller';
import { CustomerController, OptOutController } from './modules/customer/customer.controller';
import { ProductsController } from './modules/products/products.controller';
import { MembersController } from './modules/members/members.controller';
import { FilesController } from './modules/files/files.controller';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { KycController } from './modules/kyc/kyc.controller';
import { AffiliatesController } from './modules/affiliates/affiliates.controller';
import { SettingsController } from './modules/settings/settings.controller';
import { AdminController, DevController, AdminOutboxController } from './modules/admin/admin.controller';
import { HealthController } from './health.controller';
import { GoogleAuthController } from './modules/auth/google.controller';
import { AdjustmentsController } from './modules/adjustments/adjustments.controller';
import { DomainsController } from './modules/domains/domains.controller';

/** Adaptador de gateway escolhido por configuração (P3 — multigateway). */
function gatewayFactory() {
  const p = process.env.GATEWAY_PROVIDER || 'sandbox';
  if (p === 'sandbox') return new SandboxGateway();
  if (p === 'pagarme') return new PagarmeGateway();
  throw new Error(`Gateway "${p}" ainda não implementado — veja src/modules/gateway/README.md`);
}

@Module({
  imports: [EventEmitterModule.forRoot(), DiscoveryModule],
  controllers: [
    HealthController, CheckoutController, WebhooksController, SandboxController, AuthController, CustomerController, OptOutController,
    ProductsController, MembersController, FilesController, DashboardController, KycController, AffiliatesController, SettingsController,
    AdminController, DevController, AdminOutboxController, DomainsController, AdjustmentsController, GoogleAuthController,
  ],
  providers: [
    PrismaService, AuditService, StorageService, QueueService, NotifyService, LedgerService, OrdersService, CheckoutService, JobsService, FinanceService,
    { provide: GATEWAY, useFactory: gatewayFactory },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
