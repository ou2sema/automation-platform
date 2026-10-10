import type { ExecutionContext } from "../../../platform/contracts.js";
import type { ShopRoute } from "../configuration.js";
import { shopPageUrl } from "../configuration.js";
import { ShopPage } from "../pages/index.js";

export interface LandingReport {
  /** Null when the browser is not on a recognised shop page at all. */
  readonly landedOn: ShopRoute | null;
  readonly url: string;
}

/**
 * Open a shop page and report where the browser actually ended up.
 *
 * This exists separately from the page objects because an access-control scenario wants
 * the *redirect* as the outcome. Reading the route is a legitimate result there, while
 * every other flow treats an unexpected route as a failure worth throwing for.
 */
export class ShopNavigationService {
  private readonly context: ExecutionContext;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  async open(route: ShopRoute): Promise<LandingReport> {
    const shop = new ShopPage(await this.context.page(), this.timeout());
    const landedOn = await shop.open(shopPageUrl(this.context.config, route));

    this.context.logger.debug("Shop page opened.", { requested: route, landedOn });

    return { landedOn, url: shop.landedUrl() };
  }

  private timeout(): number {
    return this.context.config.browser.timeouts.navigationMs;
  }
}
