import {Effect} from "effect";

import {accessSettings} from "../core/model.js";
import type {Principal} from "../core/identity.js";
import {ArtifactRepositoryFailure} from "../core/errors.js";
import {AuthorizationService} from "./authorization.js";
import {ArtifactManagementService} from "./artifact-management.js";

/**
 * Artifact share codes: a code that lets someone without an account open the
 * current version of one private artifact. The artifact stays
 * `account_required`; the code is an extra way in. Entering the right code
 * sets an artifact- and host-bound grant cookie. Changing or removing the
 * code revokes every grant, because grants are keyed by a salt that is
 * replaced on every change.
 */

/** Query parameter that carries a submitted code on a content host. */
export const shareCodeQueryParameter = "share_code";
/** How long one successful code entry keeps working in that browser. */
export const shareGrantLifetimeSeconds = 7 * 24 * 60 * 60;
const minimumShareCodeLength = 6;
const maximumShareCodeLength = 32;
/** No 0/O, 1/I/L: generated codes are read aloud and retyped. */
const generatedCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const generatedCodeLength = 8;

/** The stored share code of one artifact. */
export interface ShareCodeRecord {
  readonly artifactId: string;
  /** Normalized code: uppercase letters and digits only. */
  readonly code: string;
  /** Random per-code key for grant cookies; replaced with every code change. */
  readonly salt: string;
  readonly setAt: string;
}

/** A private artifact whose current version a share code can unlock. */
export interface ShareCodeTarget extends ShareCodeRecord {
  /** Content-host token of the artifact's current version. */
  readonly contentToken: string;
}

/**
 * Storage port for share codes. Codes count only while their artifact is
 * active and account-required; making an artifact public drops its code, so
 * an old code never comes back when it is made private again.
 */
export interface ArtifactShareCodeStore {
  clear(artifactId: string): Promise<void>;
  close(): void;
  find(artifactId: string): Promise<ShareCodeRecord | null>;
  /** The unlockable target for an artifact, or null when none applies. */
  resolveArtifact(artifactId: string): Promise<ShareCodeTarget | null>;
  /** The unlockable target whose *current* version has this content token. */
  resolveContentToken(contentToken: string): Promise<ShareCodeTarget | null>;
  set(record: ShareCodeRecord): Promise<void>;
}

/** What a caller asks for: a server-made code, its own code, or none. */
export type ShareCodeChangeRequest =
  | {readonly kind: "clear"}
  | {readonly kind: "generate"}
  | {readonly kind: "set"; readonly shareCode: string};

/** Outcome of a share-code change. Expected rejections are answers, not failures. */
export type ShareCodeChange =
  | {readonly shareCode: string; readonly status: "set"}
  | {readonly status: "cleared"}
  | {
    readonly message: string;
    readonly status: "invalid" | "requires_private";
  };

/** Uppercase and drop spaces and hyphens, so `k7qm-3xpa` equals `K7QM3XPA`. */
export function normalizeShareCode(candidate: string): string {
  return candidate.replace(/[\s-]+/gu, "").toUpperCase();
}

/** Explain why a normalized code cannot be used, or return null when it can. */
export function shareCodeProblem(code: string): string | null {
  if (
    code.length < minimumShareCodeLength
    || code.length > maximumShareCodeLength
    || !/^[A-Z0-9]+$/u.test(code)
  ) {
    return `Share codes use ${minimumShareCodeLength}-${maximumShareCodeLength} letters or digits.`;
  }
  return null;
}

/** Show a code in groups of four, e.g. `K7QM-3XPA`. */
export function formatShareCode(code: string): string {
  return code.match(/.{1,4}/gu)?.join("-") ?? code;
}

/** A random 8-character code (about 39 bits) from an unambiguous alphabet. */
export function generateShareCode(): string {
  const alphabet = generatedCodeAlphabet;
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < generatedCodeLength) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && code.length < generatedCodeLength) {
        code += alphabet[byte % alphabet.length];
      }
    }
  }
  return code;
}

function generateSalt(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

const storeFailure = (cause: unknown) =>
  new ArtifactRepositoryFailure({cause, operation: "shareCode"});

const fromStore = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({catch: storeFailure, try: run});

interface ShareCodeCommand {
  readonly artifactId: string;
  readonly principal: Principal;
  readonly projectId: string | null;
}

const requireManagedArtifact = Effect.fn("ArtifactShareCodes.requireManaged")(
  function*(command: ShareCodeCommand) {
    const {artifact} = yield* ArtifactManagementService.use((management) =>
      management.getArtifact(command)
    );
    yield* AuthorizationService.use((authorization) =>
      authorization.requireArtifactManagement(command.principal)
    );
    return artifact;
  },
);

/** Set, generate, or clear one artifact's share code. Requires artifact management. */
export const setArtifactShareCode = Effect.fn("ArtifactShareCodes.set")(function*(
  store: ArtifactShareCodeStore,
  command: ShareCodeCommand & {readonly request: ShareCodeChangeRequest},
) {
  const artifact = yield* requireManagedArtifact(command);
  if (command.request.kind === "clear") {
    yield* fromStore(() => store.clear(artifact.id));
    const cleared: ShareCodeChange = {status: "cleared"};
    return cleared;
  }
  if (artifact.accessSetting !== accessSettings.accountRequired) {
    const requiresPrivate: ShareCodeChange = {
      message: "Share codes apply to private artifacts. Make the artifact private first.",
      status: "requires_private",
    };
    return requiresPrivate;
  }
  const code = command.request.kind === "set"
    ? normalizeShareCode(command.request.shareCode)
    : generateShareCode();
  const problem = shareCodeProblem(code);
  if (problem !== null) {
    const invalid: ShareCodeChange = {message: problem, status: "invalid"};
    return invalid;
  }
  yield* fromStore(() =>
    store.set({
      artifactId: artifact.id,
      code,
      salt: generateSalt(),
      setAt: new Date().toISOString(),
    })
  );
  const set: ShareCodeChange = {shareCode: formatShareCode(code), status: "set"};
  return set;
});

/**
 * Read one artifact's share code for display. Requires artifact management,
 * because the code itself is a credential for the artifact.
 */
export const getArtifactShareCode = Effect.fn("ArtifactShareCodes.get")(function*(
  store: ArtifactShareCodeStore,
  command: ShareCodeCommand,
) {
  const artifact = yield* requireManagedArtifact(command);
  if (artifact.accessSetting !== accessSettings.accountRequired) return null;
  const record = yield* fromStore(() => store.find(artifact.id));
  return record === null ? null : formatShareCode(record.code);
});

/** Compare a submitted code to the stored one without an early exit. */
export function shareCodeMatches(submitted: string, stored: string): boolean {
  const normalized = normalizeShareCode(submitted);
  const length = Math.max(normalized.length, stored.length);
  let difference = normalized.length ^ stored.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (normalized.charCodeAt(index) || 0) ^ (stored.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function grantSignature(
  target: ShareCodeRecord,
  host: string,
  expiresAt: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(target.salt),
    {hash: "SHA-256", name: "HMAC"},
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${target.artifactId}\n${host}\n${expiresAt}\n${target.code}`),
  );
  return Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Mint a grant cookie value bound to this artifact, host, and code. */
export async function issueShareGrant(
  target: ShareCodeRecord,
  host: string,
  nowSeconds: number,
): Promise<{readonly expiresAt: number; readonly value: string}> {
  const expiresAt = nowSeconds + shareGrantLifetimeSeconds;
  return {
    expiresAt,
    value: `${expiresAt}.${await grantSignature(target, host, expiresAt)}`,
  };
}

/** Whether a grant cookie value is still valid for this artifact and host. */
export async function verifyShareGrant(
  target: ShareCodeRecord,
  host: string,
  value: string,
  nowSeconds: number,
): Promise<boolean> {
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/u.exec(value);
  if (match === null) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt <= nowSeconds) return false;
  const expected = await grantSignature(target, host, expiresAt);
  const presented = match[2] ?? "";
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Bounds wrong-code guesses in memory: per artifact and client, and per
 * artifact overall so a spoofed client address cannot lift the ceiling.
 */
export class ShareCodeAttemptLimiter {
  readonly #failures = new Map<string, number[]>();
  readonly #windowMilliseconds: number;
  readonly #perClient: number;
  readonly #perArtifact: number;

  constructor(options: {
    readonly perArtifact?: number;
    readonly perClient?: number;
    readonly windowMilliseconds?: number;
  } = {}) {
    this.#perArtifact = options.perArtifact ?? 100;
    this.#perClient = options.perClient ?? 10;
    this.#windowMilliseconds = options.windowMilliseconds ?? 15 * 60 * 1_000;
  }

  blocked(artifactId: string, client: string, now: number): boolean {
    return this.#recent(`${artifactId}\n${client}`, now) >= this.#perClient
      || this.#recent(artifactId, now) >= this.#perArtifact;
  }

  recordFailure(artifactId: string, client: string, now: number): void {
    if (this.#failures.size > 10_000) this.#prune(now);
    for (const key of [`${artifactId}\n${client}`, artifactId]) {
      const times = this.#failures.get(key) ?? [];
      times.push(now);
      this.#failures.set(key, times);
    }
  }

  #recent(key: string, now: number): number {
    const times = this.#failures.get(key);
    if (times === undefined) return 0;
    const recent = times.filter((time) => now - time < this.#windowMilliseconds);
    if (recent.length === 0) this.#failures.delete(key);
    else this.#failures.set(key, recent);
    return recent.length;
  }

  #prune(now: number): void {
    for (const key of this.#failures.keys()) this.#recent(key, now);
  }
}
