@ui @shop @regression
Feature: Customer purchase flow

  In order to trust that business rules are exercised rather than assumed, a customer
  journey must cross every layer of the platform: a thin step delegates to a Job, the Job
  composes Services, the Services drive Page Objects, and the figures the application
  renders are compared against pricing rules calculated independently on the test side.

  Self-healing is deliberately still disabled here (recovery mode "observe"): a green
  flow must be proof of the business layer, not of a recovery engine.

  Background:
    Given a browser session for this scenario
    And the customer is signed in to the shop

  @critical
  Scenario: A qualifying order applies the published pricing rules
    When the customer adds 2 of "Mechanical Keyboard" to the cart
    And the customer adds 3 of "Braided USB-C Cable" to the cart
    Then the cart holds 5 units in total
    And the cart totals agree with the pricing rules
    When the customer proceeds to checkout
    And the customer places the order
    Then the order is confirmed with exactly one order
    And the amount paid matches the pricing rules

  @boundary
  Scenario: A small order is charged standard shipping
    When the customer adds 1 of "Wireless Mouse" to the cart
    Then the cart totals agree with the pricing rules
    And the order is below the free shipping threshold

  @regression
  Scenario: Changing the cart recalculates every total
    When the customer adds 1 of "Noise-Cancelling Headset" to the cart
    And the customer adds 2 of "Wireless Mouse" to the cart
    When the customer sets the quantity of "Wireless Mouse" to 3
    Then the cart holds 4 units in total
    And the cart totals agree with the pricing rules
    When the customer removes "Noise-Cancelling Headset" from the cart
    Then the cart holds 3 units in total
    And the cart totals agree with the pricing rules

  @negative
  Scenario: An empty cart cannot be taken to checkout
    When the customer opens the cart
    Then the cart is empty
    When the customer proceeds to checkout
    Then checkout is refused because the cart is empty
