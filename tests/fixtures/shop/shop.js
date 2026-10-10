/**
 * Fixture shop application.
 *
 * This is the system under test, not test code. It deliberately owns its own copy of
 * the pricing rules so that the platform's domain layer acts as an independent oracle:
 * if one implementation drifts, the flow fails instead of both sides agreeing on a
 * wrong number.
 *
 * State lives in `localStorage`, which is scoped to the browser context. A scenario's
 * session, cart and orders therefore cannot reach another scenario, and closing the
 * context is the whole cleanup strategy.
 *
 * Credentials are never persisted: the password field is cleared on submit and only the
 * account name and display name enter the session record.
 */

const STORAGE_KEYS = {
  session: "shop.session",
  cart: "shop.cart",
  orders: "shop.orders",
};

const ACCOUNTS = [
  { username: "ada", displayName: "Ada Lindqvist" },
  { username: "bo", displayName: "Bo Nilsson" },
];

// The fixture authenticates against an account directory and a password *policy*, never
// against a stored credential value. No password literal exists anywhere in this project,
// so there is nothing to leak, and both the accept and reject paths are still exercised.
const PASSWORD_POLICY = { minLength: 8, requireDigit: true };

const PRICING = {
  currency: "USD",
  locale: "en-US",
  standardShippingCents: 499,
  freeShippingFromCents: 7500,
  taxRatePercent: 8,
};

const LIMITS = { minQuantity: 1, maxQuantity: 99 };

const CATALOGUE = [
  { sku: "kb-01", displayName: "Mechanical Keyboard", unitPriceCents: 4900 },
  { sku: "ms-02", displayName: "Wireless Mouse", unitPriceCents: 2550 },
  { sku: "hs-03", displayName: "Noise-Cancelling Headset", unitPriceCents: 8990 },
  { sku: "cb-04", displayName: "Braided USB-C Cable", unitPriceCents: 999 },
];

const PROTECTED_ROUTES = ["catalogue", "cart", "checkout", "order-confirmation"];

function storageGet(key, fallback) {
  const raw = globalThis.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  globalThis.localStorage.setItem(key, JSON.stringify(value));
}

function readSession() {
  const session = storageGet(STORAGE_KEYS.session, null);
  if (session === null || typeof session.username !== "string" || session.username.length === 0) {
    return null;
  }
  return session;
}

function readCart() {
  const cart = storageGet(STORAGE_KEYS.cart, []);
  return Array.isArray(cart) ? cart : [];
}

function readOrders() {
  const orders = storageGet(STORAGE_KEYS.orders, []);
  return Array.isArray(orders) ? orders : [];
}

function productFor(sku) {
  return CATALOGUE.find((product) => product.sku === sku) ?? null;
}

function cartLines() {
  return readCart()
    .map((entry) => {
      const product = productFor(entry.sku);
      if (product === null) {
        return null;
      }
      return {
        sku: product.sku,
        displayName: product.displayName,
        unitPriceCents: product.unitPriceCents,
        quantity: clampQuantity(entry.quantity),
      };
    })
    .filter((line) => line !== null);
}

function clampQuantity(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return LIMITS.minQuantity;
  }
  return Math.min(LIMITS.maxQuantity, Math.max(LIMITS.minQuantity, parsed));
}

function subtotalCents(lines) {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

function shippingCents(subtotal) {
  if (subtotal <= 0) {
    return 0;
  }
  return subtotal >= PRICING.freeShippingFromCents ? 0 : PRICING.standardShippingCents;
}

function taxCents(subtotal) {
  return Math.round((subtotal * PRICING.taxRatePercent) / 100);
}

function totalsFor(lines) {
  const subtotal = subtotalCents(lines);
  const shipping = shippingCents(subtotal);
  const tax = taxCents(subtotal);
  return {
    subtotal,
    shipping,
    tax,
    total: subtotal + shipping + tax,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

function formatMoney(cents) {
  return new Intl.NumberFormat(PRICING.locale, {
    style: "currency",
    currency: PRICING.currency,
  }).format(cents / 100);
}

function queryParam(name) {
  return new URL(globalThis.location.href).searchParams.get(name);
}

function element(testId) {
  return document.querySelector(`[data-testid="${testId}"]`);
}

function setText(testId, value) {
  const target = element(testId);
  if (target !== null) {
    target.textContent = value;
  }
}

function setVisible(testId, visible) {
  const target = element(testId);
  if (target !== null) {
    target.hidden = !visible;
  }
}

function clearField(testId) {
  const target = element(testId);
  if (target !== null) {
    target.value = "";
  }
}

function renderCartCount(testId) {
  setText(testId, String(totalsFor(cartLines()).itemCount));
}

function renderSummary(lines) {
  const totals = totalsFor(lines);
  setText("cart-subtotal", formatMoney(totals.subtotal));
  setText("cart-shipping", totals.shipping === 0 ? "Free" : formatMoney(totals.shipping));
  setText("cart-tax", formatMoney(totals.tax));
  setText("cart-total", formatMoney(totals.total));
  setText("cart-count", String(totals.itemCount));
  setVisible("empty-cart", lines.length === 0);
  const proceed = element("proceed-to-checkout");
  if (proceed !== null) {
    proceed.disabled = lines.length === 0;
  }
  return totals;
}

function renderCartLines(containerTestId, lines) {
  const container = element(containerTestId);
  if (container === null) {
    return;
  }
  container.textContent = "";

  lines.forEach((line) => {
    const row = document.createElement("li");
    row.setAttribute("data-testid", "cart-line");
    row.dataset.sku = line.sku;

    const name = document.createElement("span");
    name.setAttribute("data-testid", "line-name");
    name.textContent = line.displayName;

    const unit = document.createElement("span");
    unit.setAttribute("data-testid", "line-unit-price");
    unit.textContent = formatMoney(line.unitPriceCents);

    const quantity = document.createElement("input");
    quantity.setAttribute("data-testid", "line-quantity");
    quantity.type = "number";
    quantity.min = String(LIMITS.minQuantity);
    quantity.max = String(LIMITS.maxQuantity);
    quantity.value = String(line.quantity);

    const lineTotal = document.createElement("span");
    lineTotal.setAttribute("data-testid", "line-total");
    lineTotal.textContent = formatMoney(line.unitPriceCents * line.quantity);

    const remove = document.createElement("button");
    remove.setAttribute("data-testid", "line-remove");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      storageSet(
        STORAGE_KEYS.cart,
        readCart().filter((entry) => entry.sku !== line.sku),
      );
      renderCartPage();
    });

    quantity.addEventListener("change", () => {
      const next = clampQuantity(quantity.value);
      storageSet(
        STORAGE_KEYS.cart,
        readCart().map((entry) =>
          entry.sku === line.sku ? { sku: line.sku, quantity: next } : entry,
        ),
      );
      renderCartPage();
    });

    row.append(name, unit, quantity, lineTotal, remove);
    container.append(row);
  });
}

function renderCatalogue() {
  const session = readSession();
  if (session === null) {
    return;
  }
  setText("current-user", session.displayName);
  renderCartCount("cart-count");

  const list = element("product-list");
  if (list === null) {
    return;
  }
  list.textContent = "";

  CATALOGUE.forEach((product) => {
    const row = document.createElement("li");
    row.setAttribute("data-testid", "product");
    row.dataset.sku = product.sku;

    const name = document.createElement("span");
    name.setAttribute("data-testid", "product-name");
    name.textContent = product.displayName;

    const price = document.createElement("span");
    price.setAttribute("data-testid", "product-price");
    price.textContent = formatMoney(product.unitPriceCents);

    const quantity = document.createElement("input");
    quantity.setAttribute("data-testid", "product-quantity");
    quantity.type = "number";
    quantity.min = String(LIMITS.minQuantity);
    quantity.max = String(LIMITS.maxQuantity);
    quantity.value = "1";

    const add = document.createElement("button");
    add.setAttribute("data-testid", "add-to-cart");
    add.type = "button";
    add.textContent = "Add";
    add.addEventListener("click", () => {
      const requested = clampQuantity(quantity.value);
      const cart = readCart();
      const existing = cart.find((entry) => entry.sku === product.sku);
      if (existing === undefined) {
        cart.push({ sku: product.sku, quantity: requested });
      } else {
        existing.quantity = clampQuantity(existing.quantity + requested);
      }
      storageSet(STORAGE_KEYS.cart, cart);
      renderCartCount("cart-count");
    });

    row.append(name, price, quantity, add);
    list.append(row);
  });
}

function renderCartPage() {
  const lines = cartLines();
  renderCartLines("cart-lines", lines);
  renderSummary(lines);
}

function renderCheckout() {
  const lines = cartLines();
  if (lines.length === 0) {
    globalThis.location.replace("cart.html?reason=empty");
    return;
  }

  const list = element("checkout-lines");
  if (list !== null) {
    list.textContent = "";
    lines.forEach((line) => {
      const row = document.createElement("li");
      row.setAttribute("data-testid", "checkout-line");
      row.dataset.sku = line.sku;

      const name = document.createElement("span");
      name.setAttribute("data-testid", "checkout-line-name");
      name.textContent = `${line.displayName} x ${line.quantity}`;

      const total = document.createElement("span");
      total.setAttribute("data-testid", "checkout-line-total");
      total.textContent = formatMoney(line.unitPriceCents * line.quantity);

      row.append(name, total);
      list.append(row);
    });
  }

  setText("checkout-total", formatMoney(totalsFor(lines).total));

  const form = element("checkout-form");
  if (form === null) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    // Placing an order is not idempotent: it mutates state and cannot be replayed, so
    // the control is disabled for the duration of the submit.
    const placeButton = element("place-order");
    if (placeButton !== null) {
      if (placeButton.disabled) {
        return;
      }
      placeButton.disabled = true;
    }

    const postal = (element("postal-code")?.value ?? "").trim();
    if (!/^\d{5}$/.test(postal)) {
      const message = element("checkout-error");
      if (message !== null) {
        message.hidden = false;
        message.textContent = "Enter a five-digit postal code.";
      }
      if (placeButton !== null) {
        placeButton.disabled = false;
      }
      return;
    }

    const current = cartLines();
    if (current.length === 0) {
      globalThis.location.replace("cart.html?reason=empty");
      return;
    }

    const totals = totalsFor(current);
    const orders = readOrders();
    const order = {
      reference: `ORD-${String(orders.length + 1).padStart(4, "0")}`,
      totalCents: totals.total,
      itemCount: totals.itemCount,
      deliveryNote: (element("delivery-note")?.value ?? "").trim(),
      postalCode: postal,
      placedAt: new Date().toISOString(),
    };

    orders.push(order);
    storageSet(STORAGE_KEYS.orders, orders);
    storageSet(STORAGE_KEYS.cart, []);

    globalThis.location.assign(`order-confirmation.html?reference=${order.reference}`);
  });
}

function renderOrderConfirmation() {
  const reference = queryParam("reference");
  const orders = readOrders();
  const order = orders.find((candidate) => candidate.reference === reference);

  if (order === undefined) {
    globalThis.location.replace("cart.html?reason=no-order");
    return;
  }

  setText("order-reference", order.reference);
  setText("order-total", formatMoney(order.totalCents));
  setText("order-count", String(order.itemCount));
  setText("placed-count", String(orders.length));
}

function meetsPasswordPolicy(password) {
  if (password.length < PASSWORD_POLICY.minLength) {
    return false;
  }
  return PASSWORD_POLICY.requireDigit ? /\d/.test(password) : true;
}

function findAccount(username) {
  if (username.length === 0) {
    return null;
  }
  return ACCOUNTS.find((candidate) => candidate.username === username) ?? null;
}

function renderSignIn() {
  const session = readSession();
  const notice = element("notice");

  if (notice !== null) {
    const reason = queryParam("reason");
    if (reason === "auth") {
      notice.hidden = false;
      notice.textContent = "Please sign in to continue.";
    } else if (reason === "empty") {
      notice.hidden = false;
      notice.textContent = "Your cart is empty.";
    } else {
      notice.hidden = true;
    }
  }

  setText("session-user", session === null ? "guest" : session.displayName);
  setVisible("session-user", session !== null);

  const form = element("sign-in-form");
  if (form === null) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const username = (element("username")?.value ?? "").trim().toLowerCase();
    const password = element("password")?.value ?? "";

    // Clear the credential before anything else so it never survives in the field, in
    // the session record, or in the error path below.
    clearField("password");

    const account = meetsPasswordPolicy(password) ? findAccount(username) : null;

    const error = element("auth-error");

    if (account === null) {
      // One generic message: whether the account exists is not revealed, and no part of
      // the submitted credential is echoed back.
      globalThis.localStorage.removeItem(STORAGE_KEYS.session);
      if (error !== null) {
        error.hidden = false;
        error.textContent = "Sign in failed. Check the account name and password.";
      }
      return;
    }

    storageSet(STORAGE_KEYS.session, {
      username: account.username,
      displayName: account.displayName,
      signedInAt: new Date().toISOString(),
    });
    globalThis.location.assign("catalogue.html");
  });
}

function boot() {
  const route = document.body.dataset.route ?? "";

  if (PROTECTED_ROUTES.includes(route) && readSession() === null) {
    globalThis.location.replace("sign-in.html?reason=auth");
    return;
  }

  switch (route) {
    case "sign-in":
      renderSignIn();
      break;
    case "catalogue":
      renderCatalogue();
      break;
    case "cart":
      renderCartPage();
      break;
    case "checkout":
      renderCheckout();
      break;
    case "order-confirmation":
      renderOrderConfirmation();
      break;
    default:
      break;
  }
}

boot();
