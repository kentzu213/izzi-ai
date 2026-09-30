import { MODEL_PROVIDERS, type ModelProviderConfig } from '../../types/agent-registry';
import { buildLocalModelGroup } from '../../types/model-catalog';

/**
 * Same grouping as the legacy chat page: izzi-runtime agents get every hosted
 * provider; other agents see the local endpoint first and Izzi as the fallback.
 */
export function modelGroupsFor(
  runtime: 'local' | 'izzi' | undefined,
  models: string[],
  label?: string,
): ModelProviderConfig[] {
  if (runtime === 'izzi') return MODEL_PROVIDERS;
  return [buildLocalModelGroup(models, label), MODEL_PROVIDERS.find((provider) => provider.id === 'izzi')].filter(
    (group): group is ModelProviderConfig => Boolean(group),
  );
}
