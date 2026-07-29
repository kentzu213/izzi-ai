import {
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  MARKETPLACE_IPC_CHANNELS,
  parseMarketplaceInstallOperationReceipt,
  parseMarketplaceInstallPlan,
} from '../../shared/marketplace';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';
import type { MarketplaceOperationService } from './operation-service';

function assertTrusted(event: IpcMainInvokeEvent): void {
  if (!isTrustedMarketingSender(event)) {
    throw new Error('Marketplace IPC sender is not trusted');
  }
}

function failure(reason: string): {
  readonly ok: false;
  readonly reason: string;
} {
  return { ok: false, reason };
}

export function registerMarketplaceIpc(
  service: MarketplaceOperationService,
): void {
  ipcMain.handle(MARKETPLACE_IPC_CHANNELS.loadCatalog, async (event) => {
    assertTrusted(event);
    try {
      return { ok: true as const, value: await service.loadCatalog() };
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'CATALOG_UNAVAILABLE');
    }
  });

  ipcMain.handle(
    MARKETPLACE_IPC_CHANNELS.createPlan,
    async (event, packageKey: unknown) => {
      assertTrusted(event);
      if (typeof packageKey !== 'string' || !packageKey.trim()) {
        return failure('INVALID_PACKAGE_KEY');
      }
      try {
        return { ok: true as const, value: await service.createPlan(packageKey) };
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'PLAN_UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    MARKETPLACE_IPC_CHANNELS.requestInstall,
    async (event, input: unknown) => {
      assertTrusted(event);
      try {
        const plan = parseMarketplaceInstallPlan(
          typeof input === 'object' && input !== null && 'plan' in input
            ? (input as { plan: unknown }).plan
            : input,
        );
        const receipt = await service.requestInstall(plan);
        return {
          ok: true as const,
          value: parseMarketplaceInstallOperationReceipt(receipt),
        };
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'INSTALL_REQUEST_FAILED');
      }
    },
  );

  ipcMain.handle(
    MARKETPLACE_IPC_CHANNELS.resumeInstall,
    async (event, input: unknown) => {
      assertTrusted(event);
      try {
        if (
          typeof input !== 'object'
          || input === null
          || !('plan' in input)
          || !('approvalId' in input)
          || typeof (input as { approvalId?: unknown }).approvalId !== 'string'
        ) {
          return failure('INVALID_RESUME_REQUEST');
        }
        const request = input as { plan: unknown; approvalId: string };
        const plan = parseMarketplaceInstallPlan(request.plan);
        const receipt = await service.resumeInstall(plan, request.approvalId);
        return {
          ok: true as const,
          value: parseMarketplaceInstallOperationReceipt(receipt),
        };
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'INSTALL_RESUME_FAILED');
      }
    },
  );
}
