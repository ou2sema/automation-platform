import type { BrowserContext, Page } from "playwright";

export type ArtifactKind = "trace" | "screenshot" | "video";

export interface ArtifactRecord {
  readonly kind: ArtifactKind;
  readonly path: string;
}

export interface SessionCloseResult {
  readonly artifacts: readonly ArtifactRecord[];
}

/**
 * One scenario's browser surface: a dedicated context and its primary page.
 *
 * Exposes the underlying Playwright objects because Playwright's own API is the
 * contract the Smart UI layer (Phase 3) builds on. What it deliberately does NOT
 * expose is another scenario's state: contexts are never shared.
 */
export interface IBrowserSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly artifacts: readonly ArtifactRecord[];
  recordStatus(status: string): void;
  close(): Promise<SessionCloseResult>;
}
