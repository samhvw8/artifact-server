import {Effect} from "effect";
import {afterEach, beforeEach, describe, expect, test} from "vitest";

import type {
  InteractiveAuthorization,
  InteractiveIdentityProvider,
} from "../../src/application/interactive-login.js";

import {
  browserLoginKinds,
  privateTeamBrowserAccess,
} from "../../src/core/browser-access.js";
import {
  createTestInstallation,
  fetchVersion,
  issueLocalBrowserLogin,
  loginHandshakeCookie,
  removeTestInstallation,
  reserveLoopbackPort,
  type RunningTestServer,
  startTestServer,
  type TestInstallation,
} from "../support/runtime-harness.js";
import {type PublishResponse, publishNew, publishVersion} from "../support/publishing.js";

// A browser opening a link from another app, the address bar or a bookmark.
const documentNavigation = {
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

describe("opening a private version link directly", () => {
  let installation: TestInstallation;
  let server: RunningTestServer;
  let port: number;
  let applicationOrigin: string;
  let privateArtifact: PublishResponse;

  beforeEach(async () => {
    installation = await createTestInstallation();
    port = await reserveLoopbackPort();
    applicationOrigin = `http://localhost:${port}`;
    server = await startTestServer(installation, {applicationOrigin, port});
    privateArtifact = (await publishNew(server, installation, {
      accessSetting: "account_required",
      content: "<h1>Private v1</h1>",
      idempotencyKey: "content-open-private-001",
      name: "Private page",
    })).body;
  });

  afterEach(async () => {
    await server.stop();
    await removeTestInstallation(installation);
  });

  const app = (path: string, headers?: HeadersInit) =>
    fetchVersion(server, new URL(path, applicationOrigin).toString(), "GET", headers);

  const signIn = async (): Promise<string> => {
    const token = await issueLocalBrowserLogin(server, installation);
    const login = await app(`/auth/local?token=${token}`);
    expect(login.status).toBe(303);
    return login.headers.getSetCookie()
      .map((value) => value.split(";", 1)[0] ?? "")
      .join("; ");
  };

  const openThroughSession = async (
    versionUrl: string,
    sessionCookie: string,
  ): Promise<{readonly body: string; readonly status: number}> => {
    const bounce = await fetchVersion(server, versionUrl, "GET", documentNavigation);
    expect(bounce.status).toBe(302);
    const open = await fetchVersion(
      server,
      new URL(bounce.headers.get("location") ?? "", versionUrl).toString(),
      "GET",
      {Cookie: sessionCookie},
    );
    expect(open.status).toBe(302);
    const bootstrapUrl = open.headers.get("location") ?? "";
    expect(new URL(bootstrapUrl).host).toBe(new URL(versionUrl).host);
    const exchange = await fetchVersion(server, bootstrapUrl);
    expect(exchange.status).toBe(200);
    const contentCookie = exchange.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const page = await fetchVersion(server, versionUrl, "GET", {
      ...documentNavigation,
      "Sec-Fetch-Site": "same-origin",
      Cookie: contentCookie,
    });
    return {body: await page.text(), status: page.status};
  };

  test("a page navigation without a content session bounces to the application origin", async () => {
    const versionUrl = privateArtifact.links.version;
    const response = await fetchVersion(server, versionUrl, "GET", documentNavigation);
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(applicationOrigin);
    expect(location.pathname).toBe("/content/open");
    expect(location.searchParams.get("path")).toBe("/");
    expect(location.searchParams.get("token")).toBe(new URL(versionUrl).hostname.split(".")[0]);
  });

  test("subresources, same-origin navigations and HEAD keep the plain 401", async () => {
    const versionUrl = privateArtifact.links.version;
    const plain = await fetchVersion(server, versionUrl);
    expect(plain.status).toBe(401);
    const script = await fetchVersion(server, versionUrl, "GET", {
      "Sec-Fetch-Dest": "script",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "same-site",
    });
    expect(script.status).toBe(401);
    // The bootstrap exchange's own refresh: bouncing it could loop forever.
    const refresh = await fetchVersion(server, versionUrl, "GET", {
      ...documentNavigation,
      "Sec-Fetch-Site": "same-origin",
    });
    expect(refresh.status).toBe(401);
    const frame = await fetchVersion(server, versionUrl, "GET", {
      ...documentNavigation,
      "Sec-Fetch-Dest": "iframe",
    });
    expect(frame.status).toBe(401);
    const head = await fetchVersion(server, versionUrl, "HEAD", documentNavigation);
    expect(head.status).toBe(401);
  });

  test("a signed-in member lands on the page through a one-time bootstrap", async () => {
    const sessionCookie = await signIn();
    const page = await openThroughSession(privateArtifact.links.version, sessionCookie);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<h1>Private v1</h1>");
  });

  test("an older version and a deep path open the same way", async () => {
    const updated = await publishVersion(server, installation, {
      artifactId: privateArtifact.artifact.id,
      content: "<h1>Private v2</h1>",
      expectedCurrentVersionId: privateArtifact.version.id,
      idempotencyKey: "content-open-private-002",
      path: "docs/page.html",
    });
    expect(updated.response.status).toBe(201);
    const sessionCookie = await signIn();
    const page = await openThroughSession(privateArtifact.links.version, sessionCookie);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<h1>Private v1</h1>");

    const deepUrl = new URL("/docs/page.html", updated.body.links.version).toString();
    const bounce = await fetchVersion(server, deepUrl, "GET", documentNavigation);
    const open = await fetchVersion(
      server,
      bounce.headers.get("location") ?? "",
      "GET",
      {Cookie: sessionCookie},
    );
    expect(new URL(open.headers.get("location") ?? "").pathname).toBe("/docs/page.html");
  });

  test("without a session the local owner is sent to the app to sign in", async () => {
    const response = await app(
      `/content/open?token=${new URL(privateArtifact.links.version).hostname.split(".")[0]}&path=%2F`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  test("unknown and malformed tokens are refused without a redirect", async () => {
    const sessionCookie = await signIn();
    const unknown = await app(`/content/open?token=${"a".repeat(36)}`, {Cookie: sessionCookie});
    expect(unknown.status).toBe(404);
    const malformed = await app("/content/open?token=..%2Fevil", {Cookie: sessionCookie});
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    expect(malformed.status).toBeLessThan(500);
    expect(malformed.headers.get("location")).toBeNull();
  });
});

// Signs in the bootstrap administrator without a real identity provider.
const testProvider: InteractiveIdentityProvider = {
  complete: () => Effect.succeed({
    displayName: "Team administrator",
    email: "administrator@example.test",
    emailVerified: true,
    provider: "test-oidc",
    subject: "team-administrator",
  }),
  name: "test-oidc",
  start: () => Effect.succeed<InteractiveAuthorization>({
    authorizationUrl: "https://identity.example/authorize",
    codeVerifier: "test-code-verifier-with-sufficient-entropy",
    nonce: null,
    state: "test-login-state-with-sufficient-entropy-0",
  }),
};

describe("opening a private version link on a sign-in installation", () => {
  let installation: TestInstallation;
  let server: RunningTestServer;
  let privateArtifact: PublishResponse;
  const origin = "https://artifacts.example.test";
  const forwarded = {"X-Forwarded-Host": "artifacts.example.test", "X-Forwarded-Proto": "https"};

  beforeEach(async () => {
    installation = await createTestInstallation();
    // Publish on loopback, whose upload URLs this process can reach, then
    // restart behind the public origin the redirects are built from.
    server = await startTestServer(installation);
    privateArtifact = (await publishNew(server, installation, {
      accessSetting: "account_required",
      content: "<h1>Team private</h1>",
      idempotencyKey: "content-open-team-001",
      name: "Team page",
    })).body;
    await server.stop();
    server = await startTestServer(installation, {
      applicationOrigin: origin,
      browserAccess: privateTeamBrowserAccess(browserLoginKinds.oidc),
      contentDomain: "art.example.test",
      interactiveIdentityProvider: testProvider,
    });
  });

  afterEach(async () => {
    await server.stop();
    await removeTestInstallation(installation);
  });

  test("a visitor signs in once and lands on the version they opened", async () => {
    const versionHost = `${new URL(privateArtifact.links.version).hostname.split(".")[0]}.art.example.test`;
    const bounce = await fetchVersion(server, `https://${versionHost}/`, "GET", documentNavigation);
    expect(bounce.status).toBe(302);
    const openUrl = new URL(bounce.headers.get("location") ?? "");
    expect(openUrl.origin).toBe(origin);

    const anonymous = await fetchVersion(server, openUrl.toString(), "GET", forwarded);
    expect(anonymous.status).toBe(302);
    const loginUrl = new URL(anonymous.headers.get("location") ?? "", origin);
    expect(loginUrl.pathname).toBe("/auth/login");
    const openPath = `${openUrl.pathname}${openUrl.search}`;
    expect(loginUrl.searchParams.get("returnTo")).toBe(openPath);

    const login = await fetchVersion(server, loginUrl.toString(), "GET", forwarded);
    expect(login.status).toBe(302);
    const callback = await fetchVersion(
      server,
      `${origin}/auth/callback?code=test-authorization-code&state=test-login-state-with-sufficient-entropy-0`,
      "GET",
      {...forwarded, Cookie: loginHandshakeCookie(login)},
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe(openPath);
    const sessionCookie = callback.headers.getSetCookie()
      .map((value) => value.split(";", 1)[0] ?? "")
      .join("; ");

    const open = await fetchVersion(server, `${origin}${openPath}`, "GET", {
      ...forwarded,
      Cookie: sessionCookie,
    });
    expect(open.status).toBe(302);
    const bootstrapUrl = new URL(open.headers.get("location") ?? "");
    expect(bootstrapUrl.host).toBe(versionHost);
    expect(bootstrapUrl.searchParams.has("__artifact_bootstrap")).toBe(true);
  });
});
