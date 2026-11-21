import { AppError } from "../errors/app-error.js";
import { countActiveVendorServices } from "../models/service.model.js";
import type { SubscriptionPlanName } from "../types/user.js";
import {
  FREE_PLAN_LIMIT_ERROR_CODE,
  FREE_PLAN_LIMIT_MESSAGE,
} from "./service-capacity.service.js";
import {
  canActivateWithPlan as canActivateWithEffectivePlan,
  getActiveServiceLimit,
  getVendorEffectivePlan,
} from "./subscription-plan.service.js";

export { FREE_PLAN_LIMIT_ERROR_CODE, FREE_PLAN_LIMIT_MESSAGE };

export interface ServiceLimitDependencies {
  resolvePlan: (vendorId: string) => Promise<SubscriptionPlanName>;
  countActive: (vendorId: string) => Promise<number>;
}

const defaultDependencies: ServiceLimitDependencies = {
  resolvePlan: getVendorEffectivePlan,
  countActive: countActiveVendorServices,
};

export function isActivationChange(
  currentIsActive: boolean,
  nextIsActive: boolean
): boolean {
  return !currentIsActive && nextIsActive;
}

export async function assertCanActivateService(
  vendorId: string,
  dependencies: ServiceLimitDependencies = defaultDependencies
): Promise<void> {
  const plan = await dependencies.resolvePlan(vendorId);

  if (plan === "premium") {
    return;
  }

  const activeServiceCount = await dependencies.countActive(vendorId);

  if (canActivateWithEffectivePlan(plan, activeServiceCount)) {
    return;
  }

  throw new AppError(
    403,
    FREE_PLAN_LIMIT_ERROR_CODE,
    FREE_PLAN_LIMIT_MESSAGE,
    {
      plan,
      activeServices: activeServiceCount,
      limit: getActiveServiceLimit(plan) ?? 3,
    }
  );
}
