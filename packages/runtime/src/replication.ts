/**
 * ReplicationManager — child agent spawning and lifecycle management.
 *
 * Implements the Conway Automaton's replication capability:
 * - Spawns child agents in sandboxed compute environments
 * - Funds children with USDC from parent wallet
 * - Tracks children via ChildrenRepository
 * - Enforces maxChildren and minChildFunding limits
 *
 * Governed by config.replication (maxChildren, minChildFundingCents).
 */
import type { Logger, SurvivalTier, Cents, ChildLifecycleState } from '@conshell/core';
import type { ComputeProvider } from '@conshell/compute';
import type { ChildrenRepository, InsertChild, ChildRow } from '@conshell/state';

// ── Types ───────────────────────────────────────────────────────────────

export interface ReplicationConfig {
    readonly maxChildren: number;
    readonly minChildFundingCents: number;
}

export interface ReplicationDeps {
    readonly logger: Logger;
    readonly compute: ComputeProvider;
    readonly childrenRepo: ChildrenRepository;
    readonly config: ReplicationConfig;
    /** Current USDC balance in cents */
    readonly getBalanceCents: () => Promise<number>;
}

export interface SpawnResult {
    readonly success: boolean;
    readonly childId?: string;
    readonly sandboxId?: string;
    readonly reason?: string;
}

// ── Replication Manager ─────────────────────────────────────────────────

export class ReplicationManager {
    private readonly logger: Logger;
    private readonly compute: ComputeProvider;
    private readonly childrenRepo: ChildrenRepository;
    private readonly config: ReplicationConfig;
    private readonly getBalanceCents: () => Promise<number>;

    constructor(deps: ReplicationDeps) {
        this.logger = deps.logger;
        this.compute = deps.compute;
        this.childrenRepo = deps.childrenRepo;
        this.config = deps.config;
        this.getBalanceCents = deps.getBalanceCents;
    }

    /**
     * Check if the agent can spawn a new child.
     */
    async canSpawn(tier: SurvivalTier): Promise<{ allowed: boolean; reason?: string }> {
        // Only spawn at high tier (plenty of resources)
        if (tier !== 'high') {
            return { allowed: false, reason: `Tier ${tier} too low for replication (requires 'high')` };
        }

        // Check child count using countAlive()
        const aliveCount = this.childrenRepo.countAlive();
        if (aliveCount >= this.config.maxChildren) {
            return { allowed: false, reason: `Max children reached: ${aliveCount}/${this.config.maxChildren}` };
        }

        // Check balance
        const balance = await this.getBalanceCents();
        const requiredBalance = this.config.minChildFundingCents * 2; // Need enough for child + reserve
        if (balance < requiredBalance) {
            return { allowed: false, reason: `Insufficient balance: ${balance}¢ < ${requiredBalance}¢ required` };
        }

        return { allowed: true };
    }

    /**
     * Spawn a new child agent.
     */
    async spawn(genesisPrompt: string, tier: SurvivalTier): Promise<SpawnResult> {
        const check = await this.canSpawn(tier);
        if (!check.allowed) {
            this.logger.warn('Spawn denied', { reason: check.reason });
            return { success: false, reason: check.reason };
        }

        const childId = `child-${Date.now()}`;

        try {
            // Record child in repository (initial state: spawning)
            const childData: InsertChild = {
                id: childId,
                genesisPrompt,
                fundedCents: this.config.minChildFundingCents as Cents,
            };
            this.childrenRepo.insert(childData);

            // Create sandbox for child
            const sandboxId = await this.compute.createSandbox({
                name: childId,
                memoryMb: 512,
                cpuShares: 1024,
                env: {
                    GENESIS_PROMPT: genesisPrompt,
                    PARENT_AGENT: 'conway-automaton',
                    CHILD_ID: childId,
                },
            });

            // Link sandbox to child record
            this.childrenRepo.setSandboxId(childId, sandboxId);

            // Transition state: spawning → running
            this.childrenRepo.transitionState(
                childId,
                'spawning' as ChildLifecycleState,
                'running' as ChildLifecycleState,
                'Sandbox created successfully',
            );

            this.logger.info('Child agent spawned', {
                childId,
                sandboxId,
                fundedCents: this.config.minChildFundingCents,
            });

            return { success: true, childId, sandboxId };
        } catch (err) {
            // Record failure
            try {
                this.childrenRepo.transitionState(
                    childId,
                    'spawning' as ChildLifecycleState,
                    'dead' as ChildLifecycleState,
                    `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            } catch { /* ignore transition error */ }

            this.logger.error('Child spawn failed', {
                childId,
                error: err instanceof Error ? err.message : String(err),
            });
            return {
                success: false,
                reason: err instanceof Error ? err.message : 'Unknown error',
            };
        }
    }

    /**
     * Terminate a child agent and clean up resources.
     */
    async terminate(childId: string, reason?: string): Promise<boolean> {
        try {
            const child = this.childrenRepo.findById(childId);
            if (!child) {
                this.logger.warn('Child not found for termination', { childId });
                return false;
            }

            // Destroy compute sandbox if it has one
            if (child.sandbox_id) {
                await this.compute.destroySandbox(child.sandbox_id);
            }

            // Transition state: * → dead
            this.childrenRepo.transitionState(
                childId,
                child.state as ChildLifecycleState,
                'dead' as ChildLifecycleState,
                reason ?? 'Terminated by parent',
            );

            this.logger.info('Child agent terminated', { childId, reason });
            return true;
        } catch (err) {
            this.logger.error('Child termination failed', {
                childId,
                error: err instanceof Error ? err.message : String(err),
            });
            return false;
        }
    }

    /**
     * List all running children.
     */
    listRunning(): readonly ChildRow[] {
        return this.childrenRepo.findByState('running' as ChildLifecycleState);
    }

    /**
     * List all children (any state).
     */
    listAll(): readonly ChildRow[] {
        return this.childrenRepo.listAll();
    }
}
