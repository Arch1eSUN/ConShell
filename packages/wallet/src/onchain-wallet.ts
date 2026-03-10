/**
 * OnchainWalletProvider — extends LocalWalletProvider with on-chain balance queries.
 *
 * Uses viem's publicClient to query ETH and ERC-20 (USDC) balances on Base Sepolia testnet.
 * Designed for the Conway Automaton's survival metabolism: balance → tier → death.
 */
import { createPublicClient, http, type Chain, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { LocalWalletProvider } from './local-wallet.js';
import type { EthAddress, Logger } from '@web4-agent/core';

// Base Sepolia USDC contract address (Circle testnet)
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

// Minimal ERC-20 ABI for balanceOf + decimals
const ERC20_ABI = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256' }],
    },
    {
        name: 'decimals',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: 'decimals', type: 'uint8' }],
    },
] as const;

export interface OnchainBalances {
    /** ETH balance in wei */
    readonly ethWei: bigint;
    /** ETH balance human-readable */
    readonly ethFormatted: string;
    /** USDC balance in micro-units */
    readonly usdcRaw: bigint;
    /** USDC balance human-readable (6 decimals) */
    readonly usdcFormatted: string;
    /** Total value in cents (USDC only for now) */
    readonly totalCents: number;
}

export interface OnchainWalletOptions {
    /** RPC URL override. Defaults to Base Sepolia public RPC */
    readonly rpcUrl?: string;
    /** Chain config override. Defaults to Base Sepolia */
    readonly chain?: Chain;
    /** USDC contract address override */
    readonly usdcAddress?: string;
}

export class OnchainWalletProvider extends LocalWalletProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem's PublicClient has complex chain generics
    private readonly publicClient: any;
    private readonly usdcAddress: `0x${string}`;
    private readonly onchainLogger: Logger;

    constructor(logger: Logger, options?: OnchainWalletOptions) {
        super(logger);
        this.onchainLogger = logger;
        this.usdcAddress = (options?.usdcAddress ?? USDC_ADDRESS) as `0x${string}`;

        this.publicClient = createPublicClient({
            chain: options?.chain ?? baseSepolia,
            transport: http(options?.rpcUrl),
        });
    }

    /**
     * Query on-chain balances for a given address.
     */
    async getBalances(address: EthAddress): Promise<OnchainBalances> {
        try {
            // Parallel queries for ETH and USDC balance
            const [ethWei, usdcRaw] = await Promise.all([
                this.publicClient.getBalance({ address: address as `0x${string}` }),
                this.publicClient.readContract({
                    address: this.usdcAddress,
                    abi: ERC20_ABI,
                    functionName: 'balanceOf',
                    args: [address as `0x${string}`],
                }),
            ]);

            const ethFormatted = formatUnits(ethWei, 18);
            const usdcFormatted = formatUnits(usdcRaw, 6);
            // Convert USDC to cents (1 USDC = 100 cents)
            const totalCents = Number(usdcRaw) / 10_000; // 6 decimals → cents (2 decimals)

            this.onchainLogger.debug('On-chain balances queried', {
                address,
                ethFormatted,
                usdcFormatted,
                totalCents,
            });

            return { ethWei, ethFormatted, usdcRaw, usdcFormatted, totalCents };
        } catch (err) {
            this.onchainLogger.error('Failed to query on-chain balances', {
                address,
                error: err instanceof Error ? err.message : String(err),
            });
            // Return zero balances on error — agent should conserve
            return {
                ethWei: 0n,
                ethFormatted: '0',
                usdcRaw: 0n,
                usdcFormatted: '0',
                totalCents: 0,
            };
        }
    }

    /**
     * Check if the agent can survive (has non-zero USDC balance).
     */
    async canSurvive(address: EthAddress): Promise<boolean> {
        const balances = await this.getBalances(address);
        return balances.totalCents > 0;
    }
}
