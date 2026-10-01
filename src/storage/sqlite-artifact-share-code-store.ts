import {DatabaseSync} from "node:sqlite";

import {z} from "zod";

import type {
  ArtifactShareCodeStore,
  ShareCodeRecord,
  ShareCodeTarget,
} from "../application/artifact-share-codes.js";

const recordRowSchema = z.object({
  artifactId: z.string(),
  code: z.string(),
  salt: z.string(),
  setAt: z.string(),
});
const targetRowSchema = recordRowSchema.extend({contentToken: z.string()});

const targetSelect = `
  SELECT c.artifact_id AS artifactId, c.code, c.salt, c.set_at AS setAt,
    v.content_token AS contentToken
  FROM artifact_share_codes c
  JOIN artifacts a ON a.id = c.artifact_id
  JOIN versions v ON v.id = a.current_version_id
  WHERE a.deleted_at IS NULL AND a.access_setting = 'account_required'`;

/**
 * SQLite share-code adapter sharing the compact installation database. A
 * trigger drops an artifact's code when it becomes public, whichever adapter
 * (HTTP, MCP, CLI) changed the access, so a stale code cannot come back.
 */
export class SqliteArtifactShareCodeStore implements ArtifactShareCodeStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      open: true,
      timeout: 5_000,
    });
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS artifact_share_codes (
        artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),
        code TEXT NOT NULL,
        salt TEXT NOT NULL,
        set_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS artifact_share_codes_drop_on_public
      AFTER UPDATE OF access_setting ON artifacts
      WHEN NEW.access_setting <> 'account_required'
      BEGIN
        DELETE FROM artifact_share_codes WHERE artifact_id = NEW.id;
      END;
    `);
  }

  clear(artifactId: string): Promise<void> {
    return Promise.resolve()
      .then(() =>
        this.#database
          .prepare("DELETE FROM artifact_share_codes WHERE artifact_id = ?")
          .run(artifactId)
      )
      .then(() => undefined);
  }

  close(): void {
    this.#database.close();
  }

  find(artifactId: string): Promise<ShareCodeRecord | null> {
    return Promise.resolve().then(() =>
      recordRowSchema.nullable().parse(
        this.#database
          .prepare(
            `SELECT artifact_id AS artifactId, code, salt, set_at AS setAt
             FROM artifact_share_codes WHERE artifact_id = ?`,
          )
          .get(artifactId) ?? null,
      )
    );
  }

  resolveArtifact(artifactId: string): Promise<ShareCodeTarget | null> {
    return Promise.resolve().then(() =>
      targetRowSchema.nullable().parse(
        this.#database
          .prepare(`${targetSelect} AND c.artifact_id = ?`)
          .get(artifactId) ?? null,
      )
    );
  }

  resolveContentToken(contentToken: string): Promise<ShareCodeTarget | null> {
    return Promise.resolve().then(() =>
      targetRowSchema.nullable().parse(
        this.#database
          .prepare(`${targetSelect} AND v.content_token = ?`)
          .get(contentToken) ?? null,
      )
    );
  }

  set(record: ShareCodeRecord): Promise<void> {
    return Promise.resolve()
      .then(() =>
        this.#database
          .prepare(
            `INSERT INTO artifact_share_codes (artifact_id, code, salt, set_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (artifact_id) DO UPDATE SET
               code = excluded.code, salt = excluded.salt, set_at = excluded.set_at`,
          )
          .run(record.artifactId, record.code, record.salt, record.setAt)
      )
      .then(() => undefined);
  }
}
