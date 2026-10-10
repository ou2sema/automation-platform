import type { ExecutionContext } from "../../../platform/contracts.js";
import type { ShopSession } from "../../../domains/shop/index.js";
import { shopPageUrl } from "../configuration.js";
import { CataloguePage, SignInPage } from "../pages/index.js";
import { firstFulfilled, reportUnknownOutcome, waitForRoute } from "../navigation.js";

export type SignInOutcome =
  | { readonly status: "authenticated"; readonly session: ShopSession }
  | {
      readonly status: "rejected";
      readonly message: string;
      readonly passwordCleared: boolean;
      /**
       * Reported as a fact so the scenario can assert on it. The password value itself
       * never leaves the service: it is not in this result, and it must never be placed
       * in a log, an event payload or an assertion context.
       */
      readonly credentialInMarkup: boolean;
    };

/**
 * Sign-in.
 *
 * The service, not the page object, decides what the browser's behaviour means. Arrival at
 * the catalogue is success, a visible rejection is a refused attempt, and anything else is
 * an unknown state the platform refuses to interpret — that third branch is the "fail
 * safely when uncertain" rule applied to a real flow, and it is what stops an environment
 * problem from being reported as a business outcome.
 *
 * Both outcomes are *detected* by racing their own signals, so a rejection returns as soon
 * as the page says so rather than after the navigation timeout has expired.
 */
export class SignInService {
  private readonly context: ExecutionContext;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  async attempt(input: {
    readonly username: string;
    readonly password: string;
  }): Promise<SignInOutcome> {
    const { logger } = this.context;
    const page = await this.context.page();
    const timeout = this.context.config.browser.timeouts.navigationMs;
    const signIn = new SignInPage(page, timeout);

    await signIn.open(shopPageUrl(this.context.config, "sign-in"));
    await signIn.submit(input.username, input.password);

    const signal = await firstFulfilled(
      [
        { value: "authenticated" as const, promise: waitForRoute(page, "catalogue", timeout) },
        { value: "rejected" as const, promise: signIn.rejectionSignal(timeout) },
      ],
      timeout,
    );

    if (signal === null) {
      return reportUnknownOutcome(page, ["the catalogue page", "a rejection message"]);
    }

    if (signal === "authenticated") {
      const catalogue = new CataloguePage(page, timeout);
      const displayName = await catalogue.currentUserName();
      logger.info("Shop sign in succeeded.", { outcome: "authenticated" });
      return { status: "authenticated", session: { username: input.username, displayName } };
    }

    const message = await signIn.rejectionMessage();
    if (message === null) {
      return reportUnknownOutcome(page, ["a readable rejection message"]);
    }

    const passwordCleared = await signIn.passwordFieldIsClear();
    const credentialInMarkup = await signIn.passwordAppearsInDom(input.password);

    if (credentialInMarkup) {
      // Worth an error record rather than a throw: the rejection itself is legitimate,
      // but a credential rendered into the page is a defect in the target application.
      logger.error("The submitted password still appears in the page markup.", {
        outcome: "rejected",
      });
    }

    logger.info("Shop sign in rejected.", { outcome: "rejected", passwordCleared });
    return { status: "rejected", message, passwordCleared, credentialInMarkup };
  }
}
