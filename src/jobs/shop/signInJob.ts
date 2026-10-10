import type { ExecutionContext } from "../../platform/contracts.js";
import { SignInService, type SignInOutcome } from "../../applications/shop/index.js";
import { withinJobSpan } from "../jobSpan.js";

/**
 * Use case: authenticate a customer against the shop.
 *
 * Steps call this Job; the Job composes Services; the Services drive Page Objects. A step
 * never reaches past this line to a locator, which is what keeps Gherkin free of browser
 * mechanics.
 */
export class SignInJob {
  private readonly context: ExecutionContext;
  private readonly signInService: SignInService;

  constructor(context: ExecutionContext) {
    this.context = context;
    this.signInService = new SignInService(context);
  }

  run(input: { readonly username: string; readonly password: string }): Promise<SignInOutcome> {
    return withinJobSpan(this.context, () => this.signInService.attempt(input));
  }
}
