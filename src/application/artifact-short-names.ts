import {Effect, Schema} from "effect";

import type {AccessSetting} from "../core/model.js";
import type {Principal} from "../core/identity.js";
import {ArtifactRepositoryFailure} from "../core/errors.js";
import {AuthorizationService} from "./authorization.js";
import {ArtifactManagementService} from "./artifact-management.js";
import {previewLeaseTokenPrefix} from "./content-access.js";
import {ProjectManagementService} from "./project-management.js";

/**
 * Artifact short names: one human-chosen content-host label per artifact
 * (`<name>.<content domain>`). A public-link artifact's current version is
 * served on that host, so the address stays; a private artifact redirects to
 * its review page, because content sessions are bound to version origins.
 */

/** Longest short name. Version content tokens are 36 characters, so the two never overlap. */
export const maximumShortNameLength = 32;
const minimumShortNameLength = 3;
const maximumSuggestions = 3;
/** Content-host label prefixes owned by other content routes. */
const reservedShortNamePrefixes = [previewLeaseTokenPrefix, "live-"] as const;

const shortNameSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u),
  Schema.isLengthBetween(minimumShortNameLength, maximumShortNameLength),
);
const decodeShortName = Schema.decodeUnknownOption(shortNameSchema);

/** One artifact a short name currently points to. */
export interface ShortNameTarget {
  readonly accessSetting: AccessSetting;
  readonly artifactId: string;
  /** Content-host token of the current version. */
  readonly contentToken: string;
  readonly currentVersionId: string;
  readonly projectId: string;
}

/** One assigned short name with the artifact that holds it. */
export interface ShortNameEntry {
  readonly artifactId: string;
  readonly artifactName: string;
  readonly assignedAt: string;
  readonly projectId: string;
  readonly shortName: string;
}

/**
 * Storage port for short names. Names held by deleted artifacts count as
 * free everywhere, so a tombstone never strands a name.
 */
export interface ArtifactShortNameStore {
  /** Atomically give `shortName` to the artifact, or report who holds it. */
  assign(input: {
    readonly artifactId: string;
    readonly assignedAt: string;
    readonly shortName: string;
  }): Promise<"assigned" | "taken">;
  clear(artifactId: string): Promise<void>;
  close(): void;
  findForArtifact(artifactId: string): Promise<string | null>;
  isTaken(shortName: string, exceptArtifactId: string | null): Promise<boolean>;
  list(projectId: string): Promise<readonly ShortNameEntry[]>;
  resolve(shortName: string): Promise<ShortNameTarget | null>;
}

/** Outcome of a short-name change. Expected rejections are answers, not failures. */
export type ShortNameChange =
  | {readonly status: "assigned"; readonly shortName: string}
  | {readonly status: "cleared"}
  | {
    readonly message: string;
    readonly status: "invalid" | "taken";
    readonly suggestions: readonly string[];
  };

/** Availability of one candidate name, with free alternatives when it is not. */
export interface ShortNameAvailability {
  readonly available: boolean;
  readonly message: string | null;
  readonly shortName: string;
  readonly suggestions: readonly string[];
}

/** Lowercase and trim user input before validation. */
export function normalizeShortName(candidate: string): string {
  return candidate.trim().toLowerCase();
}

/** Explain why a normalized name cannot be used, or return null when it can. */
export function shortNameProblem(shortName: string): string | null {
  if (decodeShortName(shortName)._tag === "None") {
    return `Short names use ${minimumShortNameLength}-${maximumShortNameLength} lowercase letters, digits, or hyphens, and start and end with a letter or digit.`;
  }
  if (reservedShortNamePrefixes.some((prefix) => shortName.startsWith(prefix))) {
    return `Short names cannot start with ${reservedShortNamePrefixes.join(" or ")}.`;
  }
  return null;
}

/** Turn free text such as an artifact name into a short-name candidate. */
export function slugifyShortName(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/gu, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.slice(0, maximumShortNameLength).replace(/-+$/u, "");
}

const storeFailure = (cause: unknown) =>
  new ArtifactRepositoryFailure({cause, operation: "shortName"});

const fromStore = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({catch: storeFailure, try: run});

const suggestShortNames = Effect.fn("ArtifactShortNames.suggest")(function*(
  store: ArtifactShortNameStore,
  requested: string,
  artifactName: string | null,
  artifactId: string | null,
) {
  const bases = [slugifyShortName(requested)];
  if (artifactName !== null) bases.push(slugifyShortName(artifactName));
  const candidates: string[] = [];
  for (const base of bases) {
    if (base === "") continue;
    candidates.push(base);
    for (let suffix = 2; suffix <= 9; suffix += 1) {
      const tail = `-${suffix}`;
      const stem = base.slice(0, maximumShortNameLength - tail.length).replace(/-+$/u, "");
      candidates.push(`${stem}${tail}`);
    }
  }
  const suggestions: string[] = [];
  for (const candidate of new Set(candidates)) {
    if (suggestions.length === maximumSuggestions) break;
    if (candidate === requested || shortNameProblem(candidate) !== null) continue;
    const taken = yield* fromStore(() => store.isTaken(candidate, artifactId));
    if (!taken) suggestions.push(candidate);
  }
  return suggestions;
});

const cleared: ShortNameChange = {status: "cleared"};

/** Set or clear one artifact's short name. Requires artifact management. */
export const setArtifactShortName = Effect.fn("ArtifactShortNames.set")(function*(
  store: ArtifactShortNameStore,
  command: {
    readonly artifactId: string;
    readonly principal: Principal;
    readonly projectId: string | null;
    readonly shortName: string | null;
  },
) {
  const {artifact} = yield* ArtifactManagementService.use((management) =>
    management.getArtifact(command)
  );
  yield* AuthorizationService.use((authorization) =>
    authorization.requireArtifactManagement(command.principal)
  );
  if (command.shortName === null) {
    yield* fromStore(() => store.clear(artifact.id));
    return cleared;
  }
  const shortName = normalizeShortName(command.shortName);
  const problem = shortNameProblem(shortName);
  if (problem !== null) {
    const invalid: ShortNameChange = {
      message: problem,
      status: "invalid",
      suggestions: yield* suggestShortNames(store, shortName, artifact.name, artifact.id),
    };
    return invalid;
  }
  const assignedAt = new Date().toISOString();
  const outcome = yield* fromStore(() =>
    store.assign({artifactId: artifact.id, assignedAt, shortName})
  );
  if (outcome === "taken") {
    const taken: ShortNameChange = {
      message: `The short name "${shortName}" is already used by another artifact.`,
      status: "taken",
      suggestions: yield* suggestShortNames(store, shortName, artifact.name, artifact.id),
    };
    return taken;
  }
  const assigned: ShortNameChange = {shortName, status: "assigned"};
  return assigned;
});

/** Read one artifact's short name. Requires artifact read access. */
export const getArtifactShortName = Effect.fn("ArtifactShortNames.get")(function*(
  store: ArtifactShortNameStore,
  command: {
    readonly artifactId: string;
    readonly principal: Principal;
    readonly projectId: string | null;
  },
) {
  const {artifact} = yield* ArtifactManagementService.use((management) =>
    management.getArtifact(command)
  );
  return yield* fromStore(() => store.findForArtifact(artifact.id));
});

/** List the short names assigned inside one project. */
export const listArtifactShortNames = Effect.fn("ArtifactShortNames.list")(function*(
  store: ArtifactShortNameStore,
  command: {readonly principal: Principal; readonly projectId: string | null},
) {
  const project = yield* ProjectManagementService.use((projects) =>
    projects.resolveActiveProject(command)
  );
  yield* AuthorizationService.use((authorization) =>
    authorization.requireArtifactListing(command.principal)
  );
  return yield* fromStore(() => store.list(project.id));
});

/**
 * Check whether a name is free. Names are installation-wide because they
 * share one content domain, so this reveals only whether a name is taken.
 */
export const checkShortName = Effect.fn("ArtifactShortNames.check")(function*(
  store: ArtifactShortNameStore,
  command: {
    readonly artifactId: string | null;
    readonly principal: Principal;
    readonly shortName: string;
  },
) {
  yield* AuthorizationService.use((authorization) =>
    authorization.requireArtifactListing(command.principal)
  );
  const shortName = normalizeShortName(command.shortName);
  const problem = shortNameProblem(shortName);
  const taken = problem === null
    ? yield* fromStore(() => store.isTaken(shortName, command.artifactId))
    : false;
  const available = problem === null && !taken;
  return {
    available,
    message: problem ?? (taken ? `The short name "${shortName}" is already used by another artifact.` : null),
    shortName,
    suggestions: available
      ? []
      : yield* suggestShortNames(store, shortName, null, command.artifactId),
  } satisfies ShortNameAvailability;
});
