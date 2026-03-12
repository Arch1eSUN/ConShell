// Type stub for chrome-remote-interface (optional peer dependency)
declare module 'chrome-remote-interface' {
    interface CDPOptions {
        host?: string;
        port?: number;
        target?: string;
    }

    interface CDPClient {
        Page: {
            enable(): Promise<void>;
            navigate(params: { url: string }): Promise<{ frameId: string }>;
            loadEventFired(): Promise<void>;
            captureScreenshot(params?: Record<string, unknown>): Promise<{ data: string }>;
        };
        Runtime: {
            enable(): Promise<void>;
            evaluate(params: {
                expression: string;
                returnByValue?: boolean;
                awaitPromise?: boolean;
            }): Promise<{
                result?: { value: unknown };
                exceptionDetails?: { text: string };
            }>;
        };
        DOM: {
            enable(): Promise<void>;
        };
        Network: {
            enable(): Promise<void>;
            setUserAgentOverride(params: { userAgent: string }): Promise<void>;
        };
        Emulation: {
            setDeviceMetricsOverride(params: {
                width: number;
                height: number;
                deviceScaleFactor: number;
                mobile: boolean;
            }): Promise<void>;
        };
        close(): Promise<void>;
    }

    function CDP(options?: CDPOptions): Promise<CDPClient>;
    export = CDP;
}
