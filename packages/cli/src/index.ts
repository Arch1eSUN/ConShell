/**
 * @conshell/cli — Public API
 *
 * Creator-facing admin interface for agent status, logs, and funding.
 * Onboarding wizard and doctor diagnostics.
 */
export {
    CliAdmin,
    type CliAdminDeps,
    type AgentStatusReport,
    type FinancialSummary,
    type FundResult,
    type LogOptions,
} from './admin.js';

export {
    runOnboard,
    generateDefaultConfig,
    type OnboardConfig,
    type OnboardOptions,
} from './onboard.js';

export {
    runDoctor,
    formatDoctorReport,
    type DoctorReport,
    type DoctorOptions,
    type CheckResult,
    type CheckStatus,
} from './doctor.js';
