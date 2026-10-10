@ui @smoke @platform
Feature: Platform execution health

  In order to trust the automation foundation before building on it,
  a scenario must prove that every layer of the platform is wired together:
  Gherkin reaches a thin step, the step delegates to a Job, the Job obtains the
  scenario's isolated browser session, Playwright drives a real browser, and the
  result is reported with correlation identifiers.

  Background:
    Given a browser session for this scenario

  @critical
  Scenario: A scenario drives the controlled fixture through every layer
    When I open the platform health fixture
    Then the page title is "Automation Platform Health Fixture"
    And the fixture reports that browser script executed
    And the page is at least interactive
    And the scenario carries an isolated correlation identity

  @regression
  Scenario: Correlation is distinct per scenario in the same run
    When I open the platform health fixture
    Then the page title is "Automation Platform Health Fixture"
    And the scenario carries an isolated correlation identity
