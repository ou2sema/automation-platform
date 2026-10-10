import type { PlatformConfiguration } from "../../platform/configuration/index.js";
import { resolveFixtureUrl } from "../../platform/fixtures/index.js";

/**
 * Application descriptor for the fixture shop.
 *
 * Everything that is true only of *this* target lives here: routes, fixture files and
 * the account names the fixture recognises. Nothing in `domains/` or the platform knows
 * the shop exists, which is what makes a second application an addition rather than a
 * refactor.
 */
export const SHOP_ROUTES = [
  "sign-in",
  "catalogue",
  "cart",
  "checkout",
  "order-confirmation",
] as const;

export type ShopRoute = (typeof SHOP_ROUTES)[number];

const ROUTE_FILES: Record<ShopRoute, string> = {
  "sign-in": "shop/sign-in.html",
  catalogue: "shop/catalogue.html",
  cart: "shop/cart.html",
  checkout: "shop/checkout.html",
  "order-confirmation": "shop/order-confirmation.html",
};

/** Account names the fixture recognises. These are demo identities, not credentials. */
export const SHOP_ACCOUNTS = ["ada", "bo"] as const;

export type ShopAccountName = (typeof SHOP_ACCOUNTS)[number];

export function isShopRoute(value: string | null | undefined): value is ShopRoute {
  return (
    value !== undefined && value !== null && (SHOP_ROUTES as readonly string[]).includes(value)
  );
}

export function shopPageUrl(config: PlatformConfiguration, route: ShopRoute): string {
  return resolveFixtureUrl(config, ROUTE_FILES[route]);
}

export function shopFixtureFile(route: ShopRoute): string {
  return ROUTE_FILES[route];
}
