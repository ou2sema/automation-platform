import { Then, When } from "@cucumber/cucumber";

import type { LandingReport } from "../../applications/shop/index.js";
import { OpenPageJob, SignInJob } from "../../jobs/shop/index.js";
import { AssertionFailedError } from "../../platform/errors/index.js";
import type { PlatformWorld } from "../../platform/cucumber/world.js";
import {
  REJECTED_PASSWORD,
  buildAcceptedPassword,
  createShopTestData,
} from "../../support/shopTestData.js";

/**
 * Access control steps.
 *
 * These scenarios assert on what the *application* refuses, which is a different thing from
 * the platform failing. Keeping that distinction visible is the point: a redirect is a
 * business outcome, a timeout is not, and the step layer must not blur them.
 */
const LANDING_KEY = "shop.landing";
const REJECTIONS_KEY = "shop.rejections";

interface RejectionRecord {
  readonly account: string;
  readonly message: string;
  readonly passwordCleared: boolean;
  readonly credentialInMarkup: boolean;
}

When<PlatformWorld>("the visitor opens the {string} page", async function (page: string) {
  const report = await new OpenPageJob(this).run(page);
  this.remember<LandingReport>(LANDING_KEY, report);
});

Then<PlatformWorld>("the visitor is sent to the sign-in page", function () {
  const report = this.recall<LandingReport>(LANDING_KEY);
  if (report.landedOn !== "sign-in") {
    throw new AssertionFailedError(
      `Expected the protected page to redirect to sign-in but the browser is on "${String(report.landedOn)}".`,
      { context: { landedOn: report.landedOn, url: report.url } },
    );
  }
});

When<PlatformWorld>(
  "the visitor signs in as {string} with a weak password",
  async function (account: string) {
    await recordRejection(this, account, REJECTED_PASSWORD);
  },
);

When<PlatformWorld>(
  "the visitor signs in as {string} with a policy-valid password",
  async function (account: string) {
    const data = createShopTestData(this.correlation);
    await recordRejection(this, account, buildAcceptedPassword(data.token));
  },
);

Then<PlatformWorld>("both attempts are rejected", function () {
  const rejections = this.recall<readonly RejectionRecord[]>(REJECTIONS_KEY);

  if (rejections.length !== 2) {
    throw new AssertionFailedError(
      `Expected two sign-in attempts to compare but ${String(rejections.length)} were made.`,
      { context: { attempts: rejections.length } },
    );
  }
});

Then<PlatformWorld>("both rejections use the same message", function () {
  const [first, second] = this.recall<readonly RejectionRecord[]>(REJECTIONS_KEY);

  if (first === undefined || second === undefined) {
    throw new AssertionFailedError("No rejection records were captured to compare.", {
      context: {},
    });
  }

  if (first.message.length === 0 || first.message !== second.message) {
    throw new AssertionFailedError(
      `The two rejections differ, so one of them leaks information: "${first.message}" against "${second.message}".`,
      { context: { first: first.message, second: second.message } },
    );
  }
});

Then<PlatformWorld>("no rejection reveals whether the account exists", function () {
  const rejections = this.recall<readonly RejectionRecord[]>(REJECTIONS_KEY);

  for (const rejection of rejections) {
    if (rejection.message.toLowerCase().includes(rejection.account.toLowerCase())) {
      throw new AssertionFailedError(
        "A rejection message repeats the submitted account name, which tells an attacker whether it exists.",
        { context: { account: rejection.account } },
      );
    }
  }
});

Then<PlatformWorld>("the submitted passwords are cleared from the form", function () {
  const rejections = this.recall<readonly RejectionRecord[]>(REJECTIONS_KEY);

  for (const rejection of rejections) {
    if (!rejection.passwordCleared || rejection.credentialInMarkup) {
      throw new AssertionFailedError(
        "The rejected credential was still present after sign-in failed.",
        {
          // Never include the value: the record is proof about a credential, not the credential.
          context: {
            account: rejection.account,
            passwordCleared: rejection.passwordCleared,
            credentialInMarkup: rejection.credentialInMarkup,
          },
        },
      );
    }
  }
});

async function recordRejection(
  world: PlatformWorld,
  account: string,
  password: string,
): Promise<void> {
  const outcome = await new SignInJob(world).run({ username: account, password });

  if (outcome.status === "authenticated") {
    // The scenario's premise is that this attempt fails. If the application accepted it,
    // that is a security finding, and reporting it as a plain failure is the honest move.
    throw new AssertionFailedError(
      `Sign in as "${account}" was accepted although it should have been refused.`,
      { context: { account } },
    );
  }

  const record: RejectionRecord = {
    account,
    message: outcome.message,
    passwordCleared: outcome.passwordCleared,
    credentialInMarkup: outcome.credentialInMarkup,
  };

  const previous = world.has(REJECTIONS_KEY)
    ? world.recall<readonly RejectionRecord[]>(REJECTIONS_KEY)
    : [];
  world.remember<readonly RejectionRecord[]>(REJECTIONS_KEY, [...previous, record]);
}
