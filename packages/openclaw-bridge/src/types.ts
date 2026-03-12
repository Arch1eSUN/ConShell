/**
 * @conshell/openclaw-bridge — Core type definitions.
 *
 * Shared types for all bridge subsystems:
 * - BrowserProvider (CDP + Playwright abstraction)
 * - ClawHub Adapter (remote skill registry)
 * - Channel Router (multi-instance messaging)
 */

// ── Browser Provider Types ──────────────────────────────────────────────

export interface BrowserProvider {
    /** Provider name ('playwright' | 'cdp'). */
    readonly name: string;
    /** Launch a new browser session. */
    launch(options?: BrowserLaunchOptions): Promise<BrowserSession>;
    /** Check if this provider is available (dependencies installed). */
    isAvailable(): Promise<boolean>;
    /** Shut down the provider and all sessions. */
    shutdown(): Promise<void>;
}

export interface BrowserLaunchOptions {
    /** Run headless (default true). */
    readonly headless?: boolean;
    /** Target URL to connect to (for CDP: ws://...). */
    readonly targetUrl?: string;
    /** User agent override. */
    readonly userAgent?: string;
    /** Viewport dimensions. */
    readonly viewport?: { width: number; height: number };
}

export interface BrowserSession {
    /** Unique session identifier. */
    readonly sessionId: string;
    /** Navigate to a URL. */
    navigate(url: string, opts?: NavigateOptions): Promise<PageInfo>;
    /** Execute JavaScript in the page context. */
    evaluate<T = unknown>(expression: string): Promise<T>;
    /** Take a screenshot. */
    screenshot(opts?: ScreenshotOptions): Promise<ScreenshotResult>;
    /** Query the DOM for elements. */
    querySelector(selector: string): Promise<ElementInfo[]>;
    /** Click an element by selector. */
    click(selector: string): Promise<void>;
    /** Type text into an input element. */
    type(selector: string, text: string): Promise<void>;
    /** Get the current page title. */
    title(): Promise<string>;
    /** Get the current page URL. */
    url(): string;
    /** Close this session. */
    close(): Promise<void>;
}

export interface NavigateOptions {
    /** Wait event: 'load' | 'domcontentloaded' | 'networkidle'. */
    readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    /** Timeout in milliseconds. */
    readonly timeout?: number;
    /** Post-navigation wait in milliseconds. */
    readonly waitAfter?: number;
}

export interface PageInfo {
    readonly url: string;
    readonly title: string;
    readonly textContent: string;
    readonly textLength: number;
}

export interface ScreenshotOptions {
    /** Capture full scrollable page. */
    readonly fullPage?: boolean;
    /** Image format. */
    readonly format?: 'png' | 'jpeg';
    /** JPEG quality (0-100). */
    readonly quality?: number;
}

export interface ScreenshotResult {
    readonly format: 'png' | 'jpeg';
    readonly data: Buffer;
    readonly width: number;
    readonly height: number;
}

export interface ElementInfo {
    readonly tagName: string;
    readonly text: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly visible: boolean;
}

// ── ClawHub Types ───────────────────────────────────────────────────────

export interface ClawHubAdapter {
    /** Search ClawHub for skills matching a query. */
    search(query: string, opts?: ClawHubSearchOptions): Promise<ClawHubSearchResult[]>;
    /** Download and install a skill from ClawHub. */
    install(skillName: string, targetDir: string): Promise<InstalledSkillInfo>;
    /** Fetch the manifest of a remote skill. */
    getManifest(skillName: string): Promise<RemoteSkillManifest>;
    /** Run a security audit on a skill manifest. */
    audit(manifest: RemoteSkillManifest): Promise<SkillAuditReport>;
}

export interface ClawHubSearchOptions {
    /** Maximum results (default 20). */
    readonly limit?: number;
    /** Filter by category. */
    readonly category?: string;
    /** Sort by: 'relevance' | 'downloads' | 'updated'. */
    readonly sortBy?: 'relevance' | 'downloads' | 'updated';
}

export interface ClawHubSearchResult {
    readonly name: string;
    readonly description: string;
    readonly author: string;
    readonly version: string;
    readonly downloads: number;
    readonly updatedAt: string;
    readonly categories: readonly string[];
}

export interface RemoteSkillManifest {
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly author: string;
    readonly capabilities: readonly string[];
    readonly triggers: readonly string[];
    readonly toolCount: number;
    /** Raw SKILL.md content. */
    readonly content: string;
    /** SHA-256 hash for integrity verification. */
    readonly sha256: string;
}

export interface InstalledSkillInfo {
    readonly name: string;
    readonly version: string;
    readonly installedAt: string;
    readonly path: string;
    readonly sha256: string;
}

export interface SkillAuditReport {
    readonly skillName: string;
    readonly riskScore: number; // 0-100
    readonly issues: readonly SkillAuditIssue[];
    readonly recommendation: 'safe' | 'caution' | 'dangerous' | 'blocked';
}

export interface SkillAuditIssue {
    readonly severity: 'info' | 'warning' | 'critical';
    readonly category: string;
    readonly description: string;
    readonly line?: number;
}

// ── Channel Router Types ────────────────────────────────────────────────

export interface ChannelRouter {
    /** Register a new channel. */
    addChannel(config: ChannelConfig): Promise<string>;
    /** Remove a channel by ID. */
    removeChannel(channelId: string): Promise<void>;
    /** Send a message through a channel. */
    send(channelId: string, message: ChannelMessage): Promise<void>;
    /** List all active channels. */
    listChannels(): ChannelInfo[];
    /** Create an isolated agent instance for a channel. */
    isolate(channelId: string): Promise<IsolatedInstance>;
}

export interface ChannelConfig {
    /** Channel type. */
    readonly type: 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'imessage' | 'webhook';
    /** Human-readable label. */
    readonly label: string;
    /** Connection credentials/tokens. */
    readonly credentials: Readonly<Record<string, string>>;
    /** Whether to isolate this channel into its own workspace. */
    readonly isolated?: boolean;
}

export interface ChannelMessage {
    readonly content: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ChannelInfo {
    readonly channelId: string;
    readonly type: string;
    readonly label: string;
    readonly status: 'connected' | 'disconnected' | 'error';
    readonly connectedAt?: number;
    readonly messageCount: number;
    readonly isolated: boolean;
}

export interface IsolatedInstance {
    readonly instanceId: string;
    readonly channelId: string;
    readonly workspaceDir: string;
    readonly createdAt: number;
}
