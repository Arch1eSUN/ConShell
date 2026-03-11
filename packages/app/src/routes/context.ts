/**
 * Route Context — shared dependencies and types for route modules.
 */
import type { RunningAgent } from '../kernel.js';
import type { WsManager } from '../ws.js';

// Use the global ConShellExpress types from express.d.ts
export type Request = ConShellExpress.Request;
export type Response = ConShellExpress.Response;
export type Router = ConShellExpress.Router;

export interface RouteContext {
    readonly agent: RunningAgent;
    readonly wsManager: WsManager;
}

export type RouteRegistrar = (router: Router, ctx: RouteContext) => void;
