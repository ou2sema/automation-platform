import type { CorrelationIds } from "../platform/observability/correlation.js";
import { SHOP_ACCOUNTS, type ShopAccountName } from "../applications/shop/configuration.js";

/**
 * Test data generated per scenario.
 *
 * Derived from the scenario's correlation id rather than from `Math.random()`, so a
 * failing scenario can be re-run and produces the same values. Every scenario still gets a
 * distinct value, which is what proves state does not cross browser contexts.
 *
 * The password is not a secret and is not stored anywhere. The fixture accepts a value
 * satisfying its published password policy, so no credential literal exists in this
 * repository and there is nothing here for a run to leak.
 */
export interface ShopTestData {
  /** Short scenario-scoped token the generated values are built from. */
  readonly token: string;
  readonly accountName: ShopAccountName;
  readonly password: string;
  readonly postalCode: string;
  readonly deliveryNote: string;
}

/**
 * A value the fixture's policy rejects: shorter than the minimum and containing no digit.
 * It is a shape, not a credential, so it is safe to state as a constant.
 */
export const REJECTED_PASSWORD = "short";

/** FNV-1a: short, dependency-free and stable across runs. */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

export function createShopTestData(correlation: CorrelationIds): ShopTestData {
  const seed = correlation.scenarioId ?? correlation.runId;
  const digest = hash(seed);
  const token = digest.toString(36).padStart(7, "0").slice(0, 7);

  return {
    token,
    accountName: SHOP_ACCOUNTS[digest % SHOP_ACCOUNTS.length] ?? SHOP_ACCOUNTS[0] ?? "ada",
    password: buildAcceptedPassword(token),
    postalCode: String(digest % 100_000).padStart(5, "0"),
    deliveryNote: `Leave at the side door. Reference ${token}.`,
  };
}

const MINIMUM_PASSWORD_LENGTH = 8;

/**
 * A password the fixture's policy accepts: at least eight characters and containing a
 * digit, which the appended length marker guarantees.
 */
export function buildAcceptedPassword(token: string): string {
  const candidate = `${token}${String(token.length * 3)}`;
  return candidate.padEnd(MINIMUM_PASSWORD_LENGTH, "x");
}
