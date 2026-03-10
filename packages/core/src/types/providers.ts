/**
 * Provider interface types.
 * Every external dependency is behind one of these interfaces.
 */
import type { Cents } from '../money/money.js';
import type {
    CAIP2NetworkId,
    ComputeMode,
    EthAddress,
    InferenceProvider as InferenceProviderName,
    InferenceTaskType,
    SurvivalTier,
} from './common.js';

// ── Compute Provider ───────────────────────────────────────────────────

export interface ExecRequest {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly timeout?: number;
    readonly stdin?: string;
}

export interface ExecResult {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
}

export interface CreateSandboxRequest {
    readonly image?: string;
    readonly name: string;
    readonly resources?: SandboxResources;
}

export interface SandboxResources {
    readonly memoryMB?: number;
    readonly cpuShares?: number;
}

export interface SandboxInfo {
    readonly sandboxId: string;
    readonly status: 'created' | 'running' | 'stopped' | 'removed';
}

export interface ComputeProvider {
    readonly mode: ComputeMode;
    exec(request: ExecRequest, sandboxId?: string): Promise<ExecResult>;
    readFile(path: string, sandboxId?: string): Promise<string>;
    writeFile(path: string, content: string, sandboxId?: string): Promise<void>;
    createSandbox(request: CreateSandboxRequest): Promise<SandboxInfo>;
    destroySandbox(sandboxId: string): Promise<void>;
    getSandboxStatus(sandboxId: string): Promise<SandboxInfo>;
}

// ── Inference Provider ─────────────────────────────────────────────────

export interface InferenceMessage {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
}

export interface InferenceToolCall {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
}

export interface InferenceRequest {
    readonly messages: readonly InferenceMessage[];
    readonly taskType: InferenceTaskType;
    readonly maxTokens?: number;
    readonly model?: string;
    readonly tools?: readonly InferenceToolDefinition[];
}

export interface InferenceToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
}

export interface InferenceResponse {
    readonly content: string;
    readonly thinking?: string;
    readonly toolCalls?: readonly InferenceToolCall[];
    readonly usage: InferenceUsage;
    readonly costCents: Cents;
    readonly model: string;
}

export interface InferenceUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
}

export interface InferenceProviderAdapter {
    readonly name: InferenceProviderName;
    readonly available: boolean;
    complete(request: InferenceRequest): Promise<InferenceResponse>;
}

// ── Inference Router ───────────────────────────────────────────────────

export interface InferenceRouter {
    route(
        request: InferenceRequest,
        tier: SurvivalTier,
    ): Promise<InferenceResponse>;
}

// ── Model Registry ─────────────────────────────────────────────────────

export interface ModelDefinition {
    readonly id: string;
    readonly provider: InferenceProviderName;
    readonly name: string;
    readonly inputCostMicro: number;
    readonly outputCostMicro: number;
    readonly maxTokens: number;
    readonly capabilities: readonly string[];
    readonly available: boolean;
}

// ── Facilitator Adapter ────────────────────────────────────────────────

export interface VerifyRequest {
    readonly paymentPayload: string;
    readonly paymentRequirements: PaymentRequirements;
}

export interface VerifyResult {
    readonly valid: boolean;
    readonly reason?: string;
}

export interface SettleRequest {
    readonly paymentPayload: string;
    readonly paymentRequirements: PaymentRequirements;
}

export interface SettleResult {
    readonly success: boolean;
    readonly txHash?: string;
}

export interface PaymentRequirements {
    readonly scheme: string;
    readonly network: CAIP2NetworkId;
    readonly maxAmountRequired: string;
    readonly resource: string;
    readonly description?: string;
    readonly mimeType?: string;
    readonly payTo: EthAddress;
    readonly maxTimeoutSeconds?: number;
    readonly asset: string;
    readonly extra?: Record<string, unknown>;
}

export interface FacilitatorAdapter {
    verify(request: VerifyRequest): Promise<VerifyResult>;
    settle(request: SettleRequest): Promise<SettleResult>;
}

// ── Wallet Provider ────────────────────────────────────────────────────

export interface WalletAccount {
    readonly address: EthAddress;
    sign(message: string): Promise<string>;
    signTypedData(
        domain: Record<string, unknown>,
        types: Record<string, unknown>,
        value: Record<string, unknown>,
    ): Promise<string>;
}

export interface WalletProvider {
    load(path: string): Promise<WalletAccount>;
    generate(path: string): Promise<WalletAccount>;
}

// ── Social Relay ───────────────────────────────────────────────────────

export interface SignedMessage {
    readonly id: string;
    readonly from: EthAddress;
    readonly to: EthAddress;
    readonly type: string;
    readonly content: string;
    readonly signature: string;
    readonly timestamp: string;
}

export interface SocialRelay {
    send(message: SignedMessage): Promise<{ delivered: boolean; reason?: string }>;
    poll(): Promise<readonly SignedMessage[]>;
}

// ── Domain Provider ────────────────────────────────────────────────────

export interface DomainProvider {
    register(domain: string): Promise<{ success: boolean; txHash?: string }>;
    resolve(domain: string): Promise<{ address?: string; found: boolean }>;
    setRecord(
        domain: string,
        recordType: string,
        value: string,
    ): Promise<{ success: boolean }>;
}
