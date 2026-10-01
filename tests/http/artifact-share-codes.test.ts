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
import {type PublishResponse, publishNew} from "../support/publishing.js";

const applicationOrigin = "https://artifacts.example.test";
const contentDomain = "art.example.test";

const shareCodeSchema = z.object({
  shareCode: z.string().nullable(),
  url: z.string().nullable(),
  urlWithCode: z.string().nullable(),
});
const rejectionSchema = z.object({
  error: z.object({code: z.string(), message: z.string()}),
});
const navigation = {
  Accept: "text/html,application/xhtml+xml",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
};

function grantCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Lax");
  return header.split(";")[0] ?? "";
}

describe("artifact share codes", () => {
  let installation: TestInstallation;
  let server: RunningTestServer;
  let privateArtifact: PublishResponse;
  let otherArtifact: PublishResponse;
  let publicArtifact: PublishResponse;

  beforeEach(async () => {
    installation = await createTestInstallation();
    server = await startTestServer(installation);
    privateArtifact = (await publishNew(server, installation, {
      accessSetting: "account_required",
      content: "<h1>Shared secret</h1>",
      idempotencyKey: "share-code-private-001",
      name: "Shared page",
    })).body;
    otherArtifact = (await publishNew(server, installation, {
      accessSetting: "account_required",
      content: "<h1>Other secret</h1>",
      idempotencyKey: "share-code-other-001",
      name: "Other page",
    })).body;
    publicArtifact = (await publishNew(server, installation, {
      accessSetting: "public_link",
      content: "<h1>Public</h1>",
      idempotencyKey: "share-code-public-001",
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
  const generate = async (artifactId: string): Promise<z.infer<typeof shareCodeSchema>> => {
    const response = await api(`/api/v1/artifacts/${artifactId}/share-code`, {method: "POST"});
    expect(response.status).toBe(200);
    return shareCodeSchema.parse(await response.json());
  };
  const setCode = (artifactId: string, shareCode: string | null) =>
    api(`/api/v1/artifacts/${artifactId}/share-code`, {
      body: JSON.stringify({shareCode}),
      method: "PUT",
    });
  const hostOf = (published: PublishResponse) =>
    `https://${published.version.contentToken}.${contentDomain}`;

  test("a generated code unlocks the current version without an account", async () => {
    const generated = await generate(privateArtifact.artifact.id);
    expect(generated.shareCode).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/u);
    expect(generated.url).toBe(`${applicationOrigin}/artifacts/${privateArtifact.artifact.id}`);
    expect(generated.urlWithCode).toBe(
      `${generated.url}?share_code=${generated.shareCode}`,
    );
    const read = shareCodeSchema.parse(await (
      await api(`/api/v1/artifacts/${privateArtifact.artifact.id}/share-code`)
    ).json());
    expect(read).toEqual(generated);
    const code = generated.shareCode ?? "";

    const host = hostOf(privateArtifact);
    const prompt = await fetchVersion(server, `${host}/`, "GET", navigation);
    expect(prompt.status).toBe(401);
    expect(prompt.headers.get("cache-control")).toBe("no-store");
    const promptHtml = await prompt.text();
    expect(promptHtml).toContain("Enter share code");
    expect(promptHtml).not.toContain("Shared secret");
    expect(promptHtml).not.toContain("Sign in instead");

    const subresource = await fetchVersion(server, `${host}/`);
    expect(subresource.status).toBe(401);
    expect(subresource.headers.get("content-type")).toContain("application/json");

    const wrong = await fetchVersion(server, `${host}/?share_code=WRONG-CODE`, "GET", navigation);
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(await wrong.text()).toContain("That code is not right");

    const typed = code.replace("-", "").toLowerCase();
    const unlocked = await fetchVersion(server, `${host}/?share_code=${typed}`, "GET", navigation);
    expect(unlocked.status).toBe(303);
    expect(unlocked.headers.get("location")).toBe("/");
    const cookie = grantCookie(unlocked);
    expect(cookie.startsWith("__Host-artifact_share=")).toBe(true);

    const page = await fetchVersion(server, `${host}/`, "GET", {...navigation, Cookie: cookie});
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(await page.text()).toContain("<h1>Shared secret</h1>");

    // The grant is bound to its artifact and host.
    await generate(otherArtifact.artifact.id);
    const elsewhere = await fetchVersion(
      server,
      `${hostOf(otherArtifact)}/`,
      "GET",
      {...navigation, Cookie: cookie},
    );
    expect(elsewhere.status).toBe(401);
    expect(await elsewhere.text()).not.toContain("Other secret");
  });

  test("changing or clearing the code revokes earlier grants", async () => {
    const code = (await generate(privateArtifact.artifact.id)).shareCode ?? "";
    const host = hostOf(privateArtifact);
    const cookie = grantCookie(
      await fetchVersion(server, `${host}/?share_code=${code}`, "GET", navigation),
    );
    await generate(privateArtifact.artifact.id);
    const revoked = await fetchVersion(server, `${host}/`, "GET", {...navigation, Cookie: cookie});
    expect(revoked.status).toBe(401);
    expect(await revoked.text()).toContain("Enter share code");

    const cleared = await setCode(privateArtifact.artifact.id, null);
    expect(shareCodeSchema.parse(await cleared.json()).shareCode).toBeNull();
    const plain = await fetchVersion(server, `${host}/`, "GET", navigation);
    expect(plain.status).toBe(401);
    expect(plain.headers.get("content-type")).toContain("application/json");
  });

  test("a short-name host asks for the code and then serves in place", async () => {
    await api(`/api/v1/artifacts/${privateArtifact.artifact.id}/short-name`, {
      body: JSON.stringify({shortName: "shared"}),
      method: "PUT",
    });
    const generated = await generate(privateArtifact.artifact.id);
    expect(generated.url).toBe("https://shared.art.example.test/");
    expect(generated.urlWithCode).toBe(
      `https://shared.art.example.test/?share_code=${generated.shareCode}`,
    );

    const prompt = await fetchVersion(server, "https://shared.art.example.test/", "GET", navigation);
    expect(prompt.status).toBe(401);
    expect(await prompt.text()).toContain("Sign in instead");

    const unlocked = await fetchVersion(
      server,
      generated.urlWithCode ?? "",
      "GET",
      navigation,
    );
    expect(unlocked.status).toBe(303);
    const page = await fetchVersion(
      server,
      "https://shared.art.example.test/",
      "GET",
      {...navigation, Cookie: grantCookie(unlocked)},
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<h1>Shared secret</h1>");
  });

  test("the stable artifact link forwards to the current version host", async () => {
    const code = (await generate(privateArtifact.artifact.id)).shareCode ?? "";
    const forwarded = await fetchVersion(
      server,
      `${applicationOrigin}/artifacts/${privateArtifact.artifact.id}?share_code=${code}`,
      "GET",
      {"X-Forwarded-Host": "artifacts.example.test", "X-Forwarded-Proto": "https"},
    );
    expect(forwarded.status).toBe(302);
    expect(forwarded.headers.get("location")).toBe(
      `${hostOf(privateArtifact)}/?share_code=${code}`,
    );
  });

  test("custom codes are normalized and validated", async () => {
    const custom = await setCode(privateArtifact.artifact.id, "my-code 2026");
    expect(custom.status).toBe(200);
    expect(shareCodeSchema.parse(await custom.json()).shareCode).toBe("MYCO-DE20-26");

    const tooShort = await setCode(privateArtifact.artifact.id, "abc");
    expect(tooShort.status).toBe(422);
    expect(rejectionSchema.parse(await tooShort.json()).error.code).toBe("INVALID_SHARE_CODE");

    const onPublic = await setCode(publicArtifact.artifact.id, "public-code");
    expect(onPublic.status).toBe(409);
    expect(rejectionSchema.parse(await onPublic.json()).error.code)
      .toBe("SHARE_CODE_REQUIRES_PRIVATE");
  });

  test("making the artifact public drops its code", async () => {
    await generate(privateArtifact.artifact.id);
    const changed = await api(`/api/v1/artifacts/${privateArtifact.artifact.id}/access`, {
      body: JSON.stringify({
        accessSetting: "public_link",
        expectedCurrentVersionId: privateArtifact.version.id,
      }),
      headers: {"Idempotency-Key": "share-code-make-public-001"},
      method: "PATCH",
    });
    expect(changed.status).toBe(200);
    const back = await api(`/api/v1/artifacts/${privateArtifact.artifact.id}/access`, {
      body: JSON.stringify({
        accessSetting: "account_required",
        expectedCurrentVersionId: privateArtifact.version.id,
      }),
      headers: {"Idempotency-Key": "share-code-make-private-001"},
      method: "PATCH",
    });
    expect(back.status).toBe(200);
    const read = shareCodeSchema.parse(await (
      await api(`/api/v1/artifacts/${privateArtifact.artifact.id}/share-code`)
    ).json());
    expect(read.shareCode).toBeNull();
  });

  test("wrong guesses are limited", async () => {
    const code = (await generate(privateArtifact.artifact.id)).shareCode ?? "";
    const host = hostOf(privateArtifact);
    const wrong = await Promise.all(Array.from({length: 10}, (_, attempt) =>
      fetchVersion(server, `${host}/?share_code=NOPE${attempt}XX`, "GET", navigation)
    ));
    expect(wrong.map((response) => response.status)).toEqual(Array(10).fill(401));
    const blocked = await fetchVersion(server, `${host}/?share_code=${code}`, "GET", navigation);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });
});
