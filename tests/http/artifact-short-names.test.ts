import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {z} from "zod";

import {
  createTestInstallation,
  fetchVersion,
  removeTestInstallation,
  type RunningTestServer,
  startTestServer,
  type TestInstallation,
} from "../support/runtime-harness.js";
import {type PublishResponse, publishNew, publishVersion} from "../support/publishing.js";

const applicationOrigin = "https://artifacts.example.test";
const contentDomain = "art.example.test";

const assignedSchema = z.object({shortName: z.string(), url: z.string()});
const clearedSchema = z.object({shortName: z.null(), url: z.null()});
const rejectionSchema = z.object({
  error: z.object({
    code: z.enum(["INVALID_SHORT_NAME", "SHORT_NAME_TAKEN"]),
    message: z.string(),
    suggestions: z.array(z.string()),
  }),
});
const availabilitySchema = z.object({
  available: z.boolean(),
  message: z.string().nullable(),
  shortName: z.string(),
  suggestions: z.array(z.string()),
});
const listSchema = z.object({
  shortNames: z.array(z.object({
    artifactId: z.string(),
    artifactName: z.string(),
    shortName: z.string(),
    url: z.string(),
  })),
});

describe("artifact short names", () => {
  let installation: TestInstallation;
  let server: RunningTestServer;
  let privateArtifact: PublishResponse;
  let publicArtifact: PublishResponse;

  beforeEach(async () => {
    installation = await createTestInstallation();
    // Publish on a loopback server whose upload URLs this process can reach,
    // then restart behind the public origin the redirects are built from.
    server = await startTestServer(installation);
    privateArtifact = (await publishNew(server, installation, {
      accessSetting: "account_required",
      content: "<h1>Private</h1>",
      idempotencyKey: "short-name-private-001",
      name: "Sổ tay HSK 2",
    })).body;
    publicArtifact = (await publishNew(server, installation, {
      accessSetting: "public_link",
      content: "<h1>Public</h1>",
      idempotencyKey: "short-name-public-001",
      name: "Public page",
    })).body;
    await server.stop();
    server = await startTestServer(installation, {applicationOrigin, contentDomain});
  });

  afterEach(async () => {
    await server.stop();
    await removeTestInstallation(installation);
  });

  const api = (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${installation.apiToken}`);
    headers.set("Content-Type", "application/json");
    headers.set("Host", "artifacts.example.test");
    headers.set("X-Forwarded-Host", "artifacts.example.test");
    headers.set("X-Forwarded-Proto", "https");
    return fetch(`${server.baseUrl}${path}`, {...init, headers});
  };
  const setShortName = (artifactId: string, shortName: string | null) =>
    api(`/api/v1/artifacts/${artifactId}/short-name`, {
      body: JSON.stringify({shortName}),
      method: "PUT",
    });

  test("a short name redirects to the current version and is unique", async () => {
    const assigned = await setShortName(privateArtifact.artifact.id, " Hello ");
    expect(assigned.status).toBe(200);
    expect(assignedSchema.parse(await assigned.json())).toEqual({
      shortName: "hello",
      url: "https://hello.art.example.test/",
    });

    const privateRedirect = await fetchVersion(server, "https://hello.art.example.test/");
    expect(privateRedirect.status).toBe(302);
    expect(privateRedirect.headers.get("cache-control")).toBe("no-store");
    const reviewUrl = new URL(privateRedirect.headers.get("location") ?? "");
    expect(reviewUrl.origin).toBe(applicationOrigin);
    expect(reviewUrl.pathname).toBe("/review");
    expect(reviewUrl.searchParams.get("artifact")).toBe(privateArtifact.artifact.id);
    expect(reviewUrl.searchParams.get("version")).toBe(privateArtifact.version.id);
    const posted = await fetchVersion(server, "https://hello.art.example.test/", "POST");
    expect(posted.status).not.toBe(302);

    const taken = await setShortName(publicArtifact.artifact.id, "hello");
    expect(taken.status).toBe(409);
    const takenBody = rejectionSchema.parse(await taken.json());
    expect(takenBody.error.code).toBe("SHORT_NAME_TAKEN");
    expect(takenBody.error.suggestions).toContain("hello-2");
    expect(takenBody.error.suggestions).not.toContain("hello");

    const publicAssigned = await setShortName(publicArtifact.artifact.id, "public-page");
    expect(publicAssigned.status).toBe(200);
    const publicPage = await fetchVersion(server, "https://public-page.art.example.test/");
    expect(publicPage.status).toBe(200);
    expect(publicPage.headers.get("location")).toBeNull();
    expect(publicPage.headers.get("cache-control")).toBe("public, no-cache, must-revalidate");
    expect(await publicPage.text()).toContain("<h1>Public</h1>");

    const listed = listSchema.parse(await (await api("/api/v1/short-names")).json());
    expect(listed.shortNames.map(({artifactId, shortName}) => ({artifactId, shortName})))
      .toEqual([
        {artifactId: privateArtifact.artifact.id, shortName: "hello"},
        {artifactId: publicArtifact.artifact.id, shortName: "public-page"},
      ]);
  });

  test("a public short name keeps serving the newest version", async () => {
    await setShortName(publicArtifact.artifact.id, "public-page");
    await server.stop();
    server = await startTestServer(installation);
    const updated = await publishVersion(server, installation, {
      artifactId: publicArtifact.artifact.id,
      content: "<h1>Public v2</h1>",
      expectedCurrentVersionId: publicArtifact.version.id,
      idempotencyKey: "short-name-public-002",
    });
    expect(updated.response.status).toBe(201);
    await server.stop();
    server = await startTestServer(installation, {applicationOrigin, contentDomain});
    const page = await fetchVersion(server, "https://public-page.art.example.test/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<h1>Public v2</h1>");
  });

  test("invalid and reserved names are rejected with suggestions", async () => {
    const candidates = ["Bad_Name!", "ab", "review-page", "live-page", "-edge"];
    const rejections = await Promise.all(candidates.map(async (candidate) => {
      const rejected = await setShortName(privateArtifact.artifact.id, candidate);
      return {
        code: rejectionSchema.parse(await rejected.json()).error.code,
        status: rejected.status,
      };
    }));
    expect(rejections).toEqual(candidates.map(() => ({
      code: "INVALID_SHORT_NAME",
      status: 422,
    })));
    const slugged = rejectionSchema.parse(
      await (await setShortName(privateArtifact.artifact.id, "Sổ Tay!")).json(),
    );
    expect(slugged.error.suggestions[0]).toBe("so-tay");
  });

  test("availability reports taken names and free alternatives", async () => {
    await setShortName(privateArtifact.artifact.id, "hello");
    const taken = availabilitySchema.parse(
      await (await api("/api/v1/short-names/hello/availability")).json(),
    );
    expect(taken.available).toBe(false);
    expect(taken.suggestions[0]).toBe("hello-2");
    const own = availabilitySchema.parse(await (await api(
      `/api/v1/short-names/hello/availability?artifactId=${privateArtifact.artifact.id}`,
    )).json());
    expect(own.available).toBe(true);
    const free = availabilitySchema.parse(
      await (await api("/api/v1/short-names/fresh-name/availability")).json(),
    );
    expect(free).toEqual({
      available: true,
      message: null,
      shortName: "fresh-name",
      suggestions: [],
    });
  });

  test("renaming frees the old name and clearing removes the redirect", async () => {
    await setShortName(privateArtifact.artifact.id, "first-name");
    await setShortName(privateArtifact.artifact.id, "second-name");
    const reusedOld = await setShortName(publicArtifact.artifact.id, "first-name");
    expect(reusedOld.status).toBe(200);

    const cleared = await setShortName(privateArtifact.artifact.id, null);
    expect(clearedSchema.parse(await cleared.json())).toEqual({shortName: null, url: null});
    const read = await api(`/api/v1/artifacts/${privateArtifact.artifact.id}/short-name`);
    expect(clearedSchema.parse(await read.json())).toEqual({shortName: null, url: null});

    const gone = await fetchVersion(server, "https://second-name.art.example.test/");
    expect(gone.status).not.toBe(302);
  });

  test("deleting an artifact frees its short name", async () => {
    await setShortName(privateArtifact.artifact.id, "hello");
    const deleted = await api(`/api/v1/artifacts/${privateArtifact.artifact.id}`, {
      body: JSON.stringify({expectedCurrentVersionId: privateArtifact.version.id}),
      headers: {"Idempotency-Key": "short-name-delete-001"},
      method: "DELETE",
    });
    expect(deleted.ok).toBe(true);
    const gone = await fetchVersion(server, "https://hello.art.example.test/");
    expect(gone.status).not.toBe(302);
    const reused = await setShortName(publicArtifact.artifact.id, "hello");
    expect(reused.status).toBe(200);
  });

  test("version origins are untouched by the short-name route", async () => {
    await setShortName(privateArtifact.artifact.id, "hello");
    const versionHost = `https://${privateArtifact.version.contentToken}.${contentDomain}/`;
    const version = await fetchVersion(server, versionHost);
    expect(version.status).toBe(401);
    expect(version.headers.get("location")).toBeNull();
  });
});
