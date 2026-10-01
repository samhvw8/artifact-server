import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  File01Icon,
  Globe02Icon,
  Key01Icon,
  RefreshIcon,
  SecurityLockIcon,
  Share01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Popover } from "@base-ui/react/popover";
import { useEffect, useRef, useState } from "react";

import {
  api,
  type AccessSetting,
  type ArtifactDetails,
  type ArtifactShareCode,
  type ArtifactVersion,
} from "@/api/client";
import claudeLogoUrl from "./assets/agents/claude.svg";
import codexDarkLogoUrl from "./assets/agents/codex-dark.svg";
import codexLightLogoUrl from "./assets/agents/codex-light.svg";
import copilotDarkLogoUrl from "./assets/agents/copilot-dark.svg";
import copilotLightLogoUrl from "./assets/agents/copilot-light.svg";
import cursorDarkLogoUrl from "./assets/agents/cursor-dark.svg";
import cursorLightLogoUrl from "./assets/agents/cursor-light.svg";
import opencodeDarkLogoUrl from "./assets/agents/opencode-dark.svg";
import opencodeLightLogoUrl from "./assets/agents/opencode-light.svg";
import piLogoUrl from "./assets/agents/pi.svg";
import piLightLogoUrl from "./assets/agents/pi-light.svg";

type ShareScreen = "access" | "agents" | "overview";
/** Who can open the artifact: its access setting, or private plus a share code. */
type ShareMode = AccessSetting | "share_code";
type CopiedTarget =
  | "agent-prompt"
  | "code-link"
  | "latest-link"
  | "share-code"
  | "local-command"
  | "mcp-address"
  | "raw-link"
  | "review-link";

const copiedResetMilliseconds = 1_600;

interface ReviewShareControlProps {
  readonly details: ArtifactDetails | null;
  readonly onArtifactChanged: (artifact: ArtifactDetails["artifact"]) => void;
  readonly selectedPath: string | null;
  readonly selectedVersion: ArtifactVersion | null;
  readonly triggerClassName: string;
}

/** Share one artifact from either the standard viewer header or focus controls. */
export function ReviewShareControl({
  details,
  onArtifactChanged,
  selectedPath,
  selectedVersion,
  triggerClassName,
}: ReviewShareControlProps) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<ShareScreen>("overview");
  const [selectedMode, setSelectedMode] = useState<ShareMode>(
    details?.artifact.accessSetting ?? "account_required",
  );
  // null: share codes are unavailable here (capability off, or not a manager).
  const [shareCode, setShareCode] = useState<ArtifactShareCode | null>(null);
  const [customCode, setCustomCode] = useState("");
  const [pending, setPending] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<CopiedTarget | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copiedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedResetTimer.current !== null) clearTimeout(copiedResetTimer.current);
  }, []);

  const projectId = details?.artifact.projectId ?? null;
  const artifactId = details?.artifact.id ?? null;
  const accessSetting = details?.artifact.accessSetting ?? null;
  useEffect(() => {
    if (!open || projectId === null || artifactId === null) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      let loaded: ArtifactShareCode | null = null;
      try {
        loaded = await api.shareCode(projectId, artifactId);
      } catch {
        loaded = null;
      }
      if (!cancelled) setShareCode(loaded);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, artifactId, accessSetting]);

  const activeCode = shareCode?.shareCode ?? null;
  const currentMode: ShareMode = accessSetting === "account_required" && activeCode !== null
    ? "share_code"
    : accessSetting ?? "account_required";

  const updateOpen = (next: boolean): void => {
    if (pending && !next) return;
    setOpen(next);
    if (next) {
      setScreen("overview");
      setCopiedTarget(null);
      setFailure(null);
    }
  };

  const copyText = async (
    text: string,
    target: CopiedTarget,
    failureMessage: string,
  ): Promise<void> => {
    setFailure(null);
    try {
      if (navigator.clipboard === undefined) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      if (copiedResetTimer.current !== null) clearTimeout(copiedResetTimer.current);
      copiedResetTimer.current = setTimeout(
        () => setCopiedTarget(null),
        copiedResetMilliseconds,
      );
    } catch (caught) {
      setCopiedTarget(null);
      setFailure(
        caught instanceof Error ? caught.message : failureMessage,
      );
    }
  };

  const reviewLink = selectedVersion === null
    ? null
    : exactReviewLink(selectedVersion, selectedPath);

  const copyReviewLink = async (): Promise<void> => {
    if (reviewLink === null) return;
    await copyText(
      reviewLink,
      "review-link",
      "The exact Review link could not be copied.",
    );
  };

  const copyAgentPrompt = async (): Promise<void> => {
    if (details === null || selectedVersion === null || reviewLink === null) return;
    await copyText(
      buildAgentReviewPrompt(details, selectedVersion, reviewLink),
      "agent-prompt",
      "The agent review prompt could not be copied.",
    );
  };

  const openAccess = (): void => {
    if (details === null) return;
    setSelectedMode(currentMode);
    setCustomCode("");
    setFailure(null);
    setNotice(null);
    setScreen("access");
  };

  const saveAccess = async (): Promise<void> => {
    if (details === null) return;
    const trimmedCode = customCode.trim();
    if (selectedMode === currentMode && (selectedMode !== "share_code" || trimmedCode === "")) {
      setScreen("overview");
      return;
    }
    setPending(true);
    setFailure(null);
    setNotice(null);
    try {
      const {projectId: project, id} = details.artifact;
      const access: AccessSetting = selectedMode === "public_link"
        ? "public_link"
        : "account_required";
      let warning: string | null = null;
      if (access !== details.artifact.accessSetting) {
        const changed = await api.changeAccess(
          project,
          id,
          details.artifact.currentVersionId,
          access,
          crypto.randomUUID(),
        );
        onArtifactChanged(changed.artifact);
        warning = changed.warning;
      }
      if (selectedMode === "share_code") {
        setShareCode(
          trimmedCode !== ""
            ? await api.setShareCode(project, id, trimmedCode)
            : activeCode === null
              ? await api.generateShareCode(project, id)
              : shareCode,
        );
      } else if (selectedMode === "account_required" && activeCode !== null) {
        setShareCode(await api.setShareCode(project, id, null));
      }
      setCustomCode("");
      setNotice(
        warning ?? (
          selectedMode === "public_link"
            ? "The current version can now be opened without signing in."
            : selectedMode === "share_code"
              ? "People with the code can now open the current version without signing in."
              : "This artifact now requires an admitted account."
        ),
      );
      setScreen("overview");
    } catch (caught) {
      setFailure(
        caught instanceof Error ? caught.message : "Artifact access could not be changed.",
      );
    } finally {
      setPending(false);
    }
  };

  const regenerateShareCode = async (): Promise<void> => {
    if (details === null) return;
    setPending(true);
    setFailure(null);
    setNotice(null);
    try {
      setShareCode(
        await api.generateShareCode(details.artifact.projectId, details.artifact.id),
      );
      setNotice("New code ready. The old code no longer works.");
    } catch (caught) {
      setFailure(
        caught instanceof Error ? caught.message : "A new share code could not be made.",
      );
    } finally {
      setPending(false);
    }
  };

  const publicArtifact = currentMode === "public_link";
  const codeArtifact = currentMode === "share_code";
  const serverOrigin = details === null ? "" : new URL(details.links.artifact).origin;
  const mcpAddress = `${serverOrigin}/mcp`;

  return (
    <Popover.Root open={open} onOpenChange={updateOpen}>
      <Popover.Trigger
        render={(
          <button
            aria-label="Share"
            className={triggerClassName}
            disabled={details === null || selectedVersion === null}
            type="button"
          />
        )}
      >
        <HugeiconsIcon aria-hidden="true" icon={Share01Icon} strokeWidth={1.8} />
        <span className="as-button__label">Share</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Backdrop className="as-share-backdrop" />
        <Popover.Positioner align="end" className="as-share-positioner" sideOffset={8}>
          <Popover.Popup aria-label="Share artifact" className="as-share-popover">
            {screen === "overview" ? (
              <header className="as-share-popover__header as-share-popover__header--artifact">
                <span aria-hidden="true" className="as-share-destination__icon">
                  <HugeiconsIcon icon={File01Icon} strokeWidth={1.8} />
                </span>
                <div>
                  <h2>{details?.artifact.name ?? "Artifact"}</h2>
                  <p>Exact version · Version {selectedVersion?.version.number ?? "—"}</p>
                </div>
                <button
                  aria-label="Close Share"
                  className="as-icon-button"
                  disabled={pending}
                  onClick={() => updateOpen(false)}
                  type="button"
                >
                  <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} strokeWidth={1.8} />
                </button>
              </header>
            ) : (
              <header className="as-share-popover__header">
                <button
                  aria-label="Back to Share"
                  className="as-icon-button"
                  disabled={pending}
                  onClick={() => setScreen("overview")}
                  type="button"
                >
                  <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} strokeWidth={1.8} />
                </button>
                <div>
                  <h2>{screen === "access" ? "Artifact access" : "Connect MCP"}</h2>
                  <p>{details?.artifact.name ?? "No artifact selected"}</p>
                </div>
                <button
                  aria-label="Close Share"
                  className="as-icon-button"
                  disabled={pending}
                  onClick={() => updateOpen(false)}
                  type="button"
                >
                  <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} strokeWidth={1.8} />
                </button>
              </header>
            )}

            {screen === "overview" ? (
              <div className="as-share-overview">
                <section aria-labelledby="as-share-link-heading" className="as-share-link">
                  <h3 id="as-share-link-heading">Review and comment</h3>
                  <div>
                    <code title={reviewLink ?? undefined}>{reviewLink ?? ""}</code>
                    <button
                      className="as-button as-button--primary"
                      disabled={reviewLink === null}
                      onClick={() => void copyReviewLink()}
                      type="button"
                    >
                      <HugeiconsIcon
                        aria-hidden="true"
                        icon={copiedTarget === "review-link" ? Tick02Icon : Copy01Icon}
                        strokeWidth={1.8}
                      />
                      {copiedTarget === "review-link" ? "Copied" : "Copy Review link"}
                    </button>
                  </div>
                </section>

                <div className="as-share-access-summary">
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={publicArtifact ? Globe02Icon : codeArtifact ? Key01Icon : SecurityLockIcon}
                    strokeWidth={1.8}
                  />
                  <p>
                    People with access to this Artifact Server can review this exact version.
                    {publicArtifact ? " The latest raw artifact is public." : ""}
                    {codeArtifact ? " People with the share code can open the latest version without signing in." : ""}
                  </p>
                  <button
                    className="as-button"
                    disabled={details === null}
                    onClick={openAccess}
                    type="button"
                  >
                    Manage access
                  </button>
                </div>

                <section aria-labelledby="as-share-secondary-heading" className="as-share-secondary">
                  <h3 id="as-share-secondary-heading">Other links</h3>
                  {codeArtifact && shareCode !== null ? (
                    <>
                      <ShareSecondaryLink
                        copied={copiedTarget === "share-code"}
                        description="Send it separately from the link"
                        label="Share code"
                        onCopy={() => void copyText(
                          shareCode.shareCode ?? "",
                          "share-code",
                          "The share code could not be copied.",
                        )}
                        value={shareCode.shareCode ?? ""}
                      />
                      <ShareSecondaryLink
                        copied={copiedTarget === "code-link"}
                        description="Opens without typing the code"
                        label="Link with code"
                        onCopy={() => void copyText(
                          shareCode.urlWithCode ?? "",
                          "code-link",
                          "The link with code could not be copied.",
                        )}
                        value={shareCode.urlWithCode ?? ""}
                      />
                    </>
                  ) : null}
                  <ShareSecondaryLink
                    copied={copiedTarget === "latest-link"}
                    description="Moves when a new version is published"
                    label="Latest"
                    onCopy={() => {
                      if (details !== null) {
                        void copyText(
                          details.links.artifact,
                          "latest-link",
                          "The latest artifact link could not be copied.",
                        );
                      }
                    }}
                    value={details?.links.artifact ?? ""}
                  />
                  <ShareSecondaryLink
                    copied={copiedTarget === "raw-link"}
                    description="Exact version without Review controls"
                    label="Raw"
                    onCopy={() => {
                      if (selectedVersion !== null) {
                        void copyText(
                          selectedVersion.links.version,
                          "raw-link",
                          "The raw version link could not be copied.",
                        );
                      }
                    }}
                    value={selectedVersion?.links.version ?? ""}
                  />
                </section>

                <section aria-labelledby="as-share-agent-heading" className="as-share-agent">
                  <h3 id="as-share-agent-heading">Review with an AI agent</h3>
                  <p>Copy one complete prompt into Claude, Codex, Cursor, GitHub Copilot, Pi, or OpenCode.</p>
                  <div className="as-share-agent__actions">
                    <button
                      className="as-share-agent__prompt"
                      disabled={details === null || selectedVersion === null}
                      onClick={() => void copyAgentPrompt()}
                      type="button"
                    >
                      <AgentLogos />
                      <span>
                        {copiedTarget === "agent-prompt" ? "Prompt copied" : "Copy review prompt"}
                      </span>
                      <HugeiconsIcon
                        aria-hidden="true"
                        icon={copiedTarget === "agent-prompt" ? Tick02Icon : Copy01Icon}
                        strokeWidth={1.8}
                      />
                    </button>
                    <button
                      className="as-share-agent__setup"
                      disabled={details === null}
                      onClick={() => {
                        setFailure(null);
                        setScreen("agents");
                      }}
                      type="button"
                    >
                      Connect MCP
                      <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} strokeWidth={1.8} />
                    </button>
                  </div>
                </section>

                {failure === null ? null : (
                  <p className="as-share-message" data-tone="error" role="alert">{failure}</p>
                )}
                {notice === null ? null : (
                  <p className="as-share-message" data-tone="notice" role="status">{notice}</p>
                )}
              </div>
            ) : screen === "agents" ? (
              <div className="as-share-agent-setup">
                <p>Choose the connection that matches where Artifact Server is running.</p>

                <section>
                  <header>
                    <strong>On this computer</strong>
                    <span>Recommended for local use</span>
                  </header>
                  <p>Detect a supported client, install its private MCP connection, and verify it without copying a token.</p>
                  <CopyableAgentValue
                    copied={copiedTarget === "local-command"}
                    label="Copy local connection command"
                    onCopy={() => void copyText(
                      "artifactserver connect",
                      "local-command",
                      "The local connection command could not be copied.",
                    )}
                    value="artifactserver connect"
                  />
                </section>

                <section>
                  <header>
                    <strong>Team or remote server</strong>
                    <span>MCP</span>
                  </header>
                  <p>Add this server address to the agent. Compatible deployments open browser sign-in; other self-hosted deployments use an administrator-issued scoped key.</p>
                  <CopyableAgentValue
                    copied={copiedTarget === "mcp-address"}
                    label="Copy MCP server address"
                    onCopy={() => void copyText(
                      mcpAddress,
                      "mcp-address",
                      "The MCP server address could not be copied.",
                    )}
                    value={mcpAddress}
                  />
                </section>

                <section>
                  <header>
                    <strong>Without MCP</strong>
                    <span>HTTP API</span>
                  </header>
                  <p>The review prompt includes an exact authenticated API request for this version. Use a scoped API key from an administrator and never paste it into chat.</p>
                </section>

                {failure === null ? null : (
                  <p className="as-share-message" data-tone="error" role="alert">{failure}</p>
                )}
              </div>
            ) : (
              <div className="as-share-access-editor">
                <p>Choose who can open the current version from the stable artifact link.</p>
                <fieldset>
                  <legend className="as-visually-hidden">Who can open this artifact</legend>
                  <ShareAccessOption
                    checked={selectedMode === "account_required"}
                    description="An admitted installation account is required."
                    disabled={pending}
                    label="Private"
                    onChange={() => setSelectedMode("account_required")}
                    value="account_required"
                  />
                  {shareCode === null ? null : (
                    <ShareAccessOption
                      checked={selectedMode === "share_code"}
                      description="Private, but anyone with the link and the code can open the current version without signing in."
                      disabled={pending}
                      label="Share code"
                      onChange={() => setSelectedMode("share_code")}
                      value="share_code"
                    />
                  )}
                  <ShareAccessOption
                    checked={selectedMode === "public_link"}
                    description="No sign-in. Anyone who can reach this server and has the link can open the current version."
                    disabled={pending}
                    label="Public link"
                    onChange={() => setSelectedMode("public_link")}
                    value="public_link"
                  />
                </fieldset>
                {selectedMode === "share_code" ? (
                  <div className="as-share-code-editor">
                    {currentMode === "share_code" && activeCode !== null ? (
                      <div className="as-share-code-editor__current">
                        <code>{activeCode}</code>
                        <button
                          className="as-button"
                          disabled={pending}
                          onClick={() => void regenerateShareCode()}
                          type="button"
                        >
                          <HugeiconsIcon aria-hidden="true" icon={RefreshIcon} strokeWidth={1.8} />
                          New code
                        </button>
                      </div>
                    ) : null}
                    <label>
                      <span>
                        {currentMode === "share_code"
                          ? "Or set your own code"
                          : "Your own code (leave empty to generate one)"}
                      </span>
                      <input
                        autoComplete="off"
                        disabled={pending}
                        maxLength={64}
                        onChange={(event) => setCustomCode(event.target.value)}
                        placeholder="At least 6 letters or digits"
                        spellCheck={false}
                        type="text"
                        value={customCode}
                      />
                    </label>
                    <small>Changing the code locks out everyone who used the old one.</small>
                  </div>
                ) : null}
                <p className="as-share-network-note">
                  Public access does not create a tunnel, open a firewall, or make an unreachable server reachable.
                </p>
                {selectedMode !== currentMode ? (
                  <p className="as-share-access-warning">
                    {selectedMode === "public_link"
                      ? "The link can be redistributed. Earlier versions and history stay account-required."
                      : selectedMode === "share_code"
                        ? "The code and link can be passed on. Earlier versions and history stay account-required."
                        : "Downloaded or externally cached copies cannot be recalled."}
                  </p>
                ) : null}
                {failure === null ? null : (
                  <p className="as-share-message" data-tone="error" role="alert">{failure}</p>
                )}
                <div className="as-share-access-editor__actions">
                  <button
                    className="as-button"
                    disabled={pending}
                    onClick={() => setScreen("overview")}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="as-button as-button--primary"
                    disabled={
                      details === null
                      || pending
                      || (
                        selectedMode === currentMode
                        && (selectedMode !== "share_code" || customCode.trim() === "")
                      )
                    }
                    onClick={() => void saveAccess()}
                    type="button"
                  >
                    {pending ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}

            {screen === "overview" ? (
              <footer className="as-share-popover__footer">
                This Review link stays pinned to Version {selectedVersion?.version.number ?? "—"}
                {selectedPath === null ? "." : ` and ${selectedPath}.`}
              </footer>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AgentLogos() {
  return (
    <span
      aria-label="Claude, Codex, Cursor, GitHub Copilot, Pi, and OpenCode"
      className="as-agent-logos"
      role="img"
    >
      <span aria-hidden="true" className="as-agent-logo">
        <img alt="" src={claudeLogoUrl} />
      </span>
      <ThemedAgentLogo
        darkUrl={codexDarkLogoUrl}
        lightUrl={codexLightLogoUrl}
      />
      <ThemedAgentLogo
        darkUrl={cursorDarkLogoUrl}
        lightUrl={cursorLightLogoUrl}
      />
      <ThemedAgentLogo
        darkUrl={copilotDarkLogoUrl}
        lightUrl={copilotLightLogoUrl}
      />
      <ThemedAgentLogo darkUrl={piLogoUrl} lightUrl={piLightLogoUrl} />
      <ThemedAgentLogo
        darkUrl={opencodeDarkLogoUrl}
        lightUrl={opencodeLightLogoUrl}
      />
    </span>
  );
}

function ThemedAgentLogo({
  darkUrl,
  lightUrl,
}: {
  readonly darkUrl: string;
  readonly lightUrl: string;
}) {
  return (
    <span aria-hidden="true" className="as-agent-logo">
      <img alt="" data-agent-theme="dark" src={darkUrl} />
      <img alt="" data-agent-theme="light" src={lightUrl} />
    </span>
  );
}

function CopyableAgentValue({
  copied,
  label,
  onCopy,
  value,
}: {
  readonly copied: boolean;
  readonly label: string;
  readonly onCopy: () => void;
  readonly value: string;
}) {
  return (
    <div className="as-share-agent-value">
      <code title={value}>{value}</code>
      <button aria-label={label} onClick={onCopy} type="button">
        <HugeiconsIcon
          aria-hidden="true"
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={1.8}
        />
      </button>
    </div>
  );
}

function ShareSecondaryLink({
  copied,
  description,
  label,
  onCopy,
  value,
}: {
  readonly copied: boolean;
  readonly description: string;
  readonly label: string;
  readonly onCopy: () => void;
  readonly value: string;
}) {
  return (
    <div className="as-share-secondary__row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <code title={value}>{value}</code>
      <button
        aria-label={`Copy ${label.toLocaleLowerCase("en-US")} link`}
        className="as-icon-button"
        disabled={value === ""}
        onClick={onCopy}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden="true"
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={1.8}
        />
      </button>
    </div>
  );
}

function exactReviewLink(
  selectedVersion: ArtifactVersion,
  selectedPath: string | null,
): string {
  const reviewUrl = new URL(selectedVersion.links.review);
  reviewUrl.searchParams.set("view", "focus");
  if (
    selectedPath !== null
    && selectedVersion.manifest.entries.some((entry) => entry.path === selectedPath)
  ) {
    reviewUrl.searchParams.set("path", selectedPath);
  } else {
    reviewUrl.searchParams.delete("path");
  }
  return reviewUrl.toString();
}

function buildAgentReviewPrompt(
  details: ArtifactDetails,
  selectedVersion: ArtifactVersion,
  reviewLink: string,
): string {
  const serverOrigin = new URL(details.links.artifact).origin;
  const apiUrl = new URL(
    `/api/v1/artifacts/${encodeURIComponent(details.artifact.id)}/versions/${encodeURIComponent(selectedVersion.version.id)}`,
    serverOrigin,
  );
  apiUrl.searchParams.set("projectId", details.artifact.projectId);
  const manifestResource = `artifact://projects/${details.artifact.projectId}/artifacts/${details.artifact.id}/versions/${selectedVersion.version.id}/manifest`;

  return `Review this Artifact Server artifact. Inspect the exact saved version below and do not silently substitute a newer version.

Artifact: ${details.artifact.name}
Project ID: ${details.artifact.projectId}
Artifact ID: ${details.artifact.id}
Version: ${selectedVersion.version.number}
Version ID: ${selectedVersion.version.id}
Access: ${details.artifact.accessSetting === "public_link" ? "public link" : "private"}
Review and comment: ${reviewLink}
Raw exact version: ${selectedVersion.links.version}
Moving latest link: ${details.links.artifact}

Preferred path — Artifact Server MCP:
1. Call artifact_get with projectId "${details.artifact.projectId}" and artifactId "${details.artifact.id}".
2. Keep versionId "${selectedVersion.version.id}" pinned. If artifact_get reports a different current version, use artifact_version_list and review the pinned version instead.
3. Read the exact manifest resource when available: ${manifestResource}
4. Use artifact_open.reviewUrl for the full-screen Review experience. Use artifact_open.browserUrl only when you need the raw rendered artifact.
5. Review the artifact and report findings in priority order. When comment tools are available, use comment_create against this exact version for precise, actionable findings.

If Artifact Server MCP is not connected:
- Local setup: run artifactserver connect, then retry with MCP.
- Remote or team setup: add ${serverOrigin}/mcp to the agent and complete browser sign-in, or use an administrator-issued scoped key when OAuth is unavailable.
- Direct HTTP fallback: GET ${apiUrl.toString()} with an admitted session or scoped API key.
- curl example: curl --fail-with-body --header "Authorization: Bearer $ARTIFACT_SERVER_API_KEY" '${apiUrl.toString()}'

Never paste credentials into chat, source files, or the review. If access fails, state which connection or permission is missing.`;
}

function ShareAccessOption({
  checked,
  description,
  disabled,
  label,
  onChange,
  value,
}: {
  readonly checked: boolean;
  readonly description: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: () => void;
  readonly value: ShareMode;
}) {
  return (
    <label className="as-share-access-option" data-checked={checked}>
      <input
        checked={checked}
        disabled={disabled}
        name="review-artifact-access"
        onChange={onChange}
        type="radio"
        value={value}
      />
      <span aria-hidden="true" className="as-share-access-option__indicator" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
