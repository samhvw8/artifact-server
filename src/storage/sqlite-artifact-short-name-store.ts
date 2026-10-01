import {DatabaseSync} from "node:sqlite";

import {z} from "zod";

import type {
  ArtifactShortNameStore,
  ShortNameEntry,
  ShortNameTarget,
} from "../application/artifact-short-names.js";
import {accessSettings} from "../core/model.js";

const accessSettingSchema = z.enum([
  accessSettings.accountRequired,
  accessSettings.publicLink,
]);
const targetRowSchema = z.object({
  accessSetting: accessSettingSchema,
  artifactId: z.string(),
  currentVersionId: z.string(),
  projectId: z.string(),
});
const entryRowSchema = z.object({
  artifactId: z.string(),
  artifactName: z.string(),
  assignedAt: z.string(),
  projectId: z.string(),
  shortName: z.string(),
});
const holderRowSchema = z.object({artifactId: z.string()});
const nameRowSchema = z.object({shortName: z.string()});

/**
 * SQLite short-name adapter sharing the compact installation database. Only
 * names whose artifact is still active count as held.
 */
export class SqliteArtifactShortNameStore implements ArtifactShortNameStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      open: true,
      timeout: 5_000,
    });
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS artifact_short_names (
        short_name TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL UNIQUE REFERENCES artifacts(id),
        assigned_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  assign(input: {
    readonly artifactId: string;
    readonly assignedAt: string;
    readonly shortName: string;
  }): Promise<"assigned" | "taken"> {
    return Promise.resolve().then(() => {
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        const holder = holderRowSchema.nullable().parse(
          this.#database
            .prepare(
              `SELECT n.artifact_id AS artifactId
               FROM artifact_short_names n
               JOIN artifacts a ON a.id = n.artifact_id
               WHERE n.short_name = ? AND a.deleted_at IS NULL`,
            )
            .get(input.shortName) ?? null,
        );
        if (holder !== null && holder.artifactId !== input.artifactId) {
          this.#database.exec("ROLLBACK");
          return "taken";
        }
        this.#database
          .prepare(
            "DELETE FROM artifact_short_names WHERE short_name = ? OR artifact_id = ?",
          )
          .run(input.shortName, input.artifactId);
        this.#database
          .prepare(
            `INSERT INTO artifact_short_names (short_name, artifact_id, assigned_at)
             VALUES (?, ?, ?)`,
          )
          .run(input.shortName, input.artifactId, input.assignedAt);
        this.#database.exec("COMMIT");
        return "assigned";
      } catch (cause) {
        if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
        throw cause;
      }
    });
  }

  clear(artifactId: string): Promise<void> {
    return Promise.resolve()
      .then(() =>
        this.#database
          .prepare("DELETE FROM artifact_short_names WHERE artifact_id = ?")
          .run(artifactId)
      )
      .then(() => undefined);
  }

  close(): void {
    this.#database.close();
  }

  findForArtifact(artifactId: string): Promise<string | null> {
    return Promise.resolve().then(() => {
      const row = nameRowSchema.nullable().parse(
        this.#database
          .prepare(
            `SELECT short_name AS shortName FROM artifact_short_names
             WHERE artifact_id = ?`,
          )
          .get(artifactId) ?? null,
      );
      return row?.shortName ?? null;
    });
  }

  isTaken(shortName: string, exceptArtifactId: string | null): Promise<boolean> {
    return Promise.resolve().then(() => {
      const holder = holderRowSchema.nullable().parse(
        this.#database
          .prepare(
            `SELECT n.artifact_id AS artifactId
             FROM artifact_short_names n
             JOIN artifacts a ON a.id = n.artifact_id
             WHERE n.short_name = ? AND a.deleted_at IS NULL`,
          )
          .get(shortName) ?? null,
      );
      return holder !== null && holder.artifactId !== exceptArtifactId;
    });
  }

  list(projectId: string): Promise<readonly ShortNameEntry[]> {
    return Promise.resolve().then(() =>
      z.array(entryRowSchema).parse(
        this.#database
          .prepare(
            `SELECT n.short_name AS shortName, n.artifact_id AS artifactId,
               a.name AS artifactName, a.project_id AS projectId,
               n.assigned_at AS assignedAt
             FROM artifact_short_names n
             JOIN artifacts a ON a.id = n.artifact_id
             WHERE a.project_id = ? AND a.deleted_at IS NULL
             ORDER BY n.short_name`,
          )
          .all(projectId),
      )
    );
  }

  resolve(shortName: string): Promise<ShortNameTarget | null> {
    return Promise.resolve().then(() =>
      targetRowSchema.nullable().parse(
        this.#database
          .prepare(
            `SELECT a.id AS artifactId, a.project_id AS projectId,
               a.access_setting AS accessSetting,
               a.current_version_id AS currentVersionId
             FROM artifact_short_names n
             JOIN artifacts a ON a.id = n.artifact_id
             WHERE n.short_name = ? AND a.deleted_at IS NULL
               AND a.current_version_id IS NOT NULL`,
          )
          .get(shortName) ?? null,
      )
    );
  }
}
