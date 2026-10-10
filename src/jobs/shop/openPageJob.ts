import type { ExecutionContext } from "../../platform/contracts.js";
import { PlatformError, PlatformErrorCode } from "../../platform/errors/index.js";
import {
  isShopRoute,
  SHOP_ROUTES,
  ShopNavigationService,
  type LandingReport,
  type ShopRoute,
} from "../../applications/shop/index.js";
import { withinJobSpan } from "../jobSpan.js";

/**
 * Use case: attempt to visit a shop page, and report what happened.
 *
 * Used by access-control scenarios where being redirected is the expected business
 * outcome. Reporting rather than asserting keeps the step thin, while every other flow
 * still fails loudly when a page is not where it should be.
 *
 * The route name arrives as text from Gherkin and is validated here, so an unknown page is
 * a loud configuration-style failure at the boundary rather than a confusing element error
 * three layers deeper.
 */
export class OpenPageJob {
  private readonly context: ExecutionContext;
  private readonly navigation: ShopNavigationService;

  constructor(context: ExecutionContext) {
    this.context = context;
    this.navigation = new ShopNavigationService(context);
  }

  run(routeName: string): Promise<LandingReport> {
    if (!isShopRoute(routeName)) {
      throw new PlatformError(
        PlatformErrorCode.NAVIGATION_FAILED,
        `"${routeName}" is not a page of the shop. Known pages: ${SHOP_ROUTES.join(", ")}.`,
        { severity: "critical", context: { requested: routeName, known: SHOP_ROUTES } },
      );
    }

    const route: ShopRoute = routeName;
    return withinJobSpan(this.context, () => this.navigation.open(route));
  }
}
