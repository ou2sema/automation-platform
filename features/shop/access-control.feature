@ui @shop @access-control
Feature: Shop access control

  In order to prove the platform can distinguish "the application refused" from "the test
  broke", the flow must observe protection rules from outside: an unauthenticated visitor is
  redirected, and a rejected sign-in reveals nothing about the account or the credential.

  Background:
    Given a browser session for this scenario

  @critical
  Scenario: A protected page redirects a visitor who is not signed in
    When the visitor opens the "cart" page
    Then the visitor is sent to the sign-in page

  @critical
  Scenario Outline: Every protected page redirects a visitor who is not signed in
    When the visitor opens the "<page>" page
    Then the visitor is sent to the sign-in page

    Examples:
      | page               |
      | catalogue          |
      | checkout           |
      | order-confirmation |

  @security
  Scenario: Sign-in failures are indistinguishable and reveal no credential
    When the visitor signs in as "ada" with a weak password
    And the visitor signs in as "nobody" with a policy-valid password
    Then both attempts are rejected
    And both rejections use the same message
    And no rejection reveals whether the account exists
    And the submitted passwords are cleared from the form
