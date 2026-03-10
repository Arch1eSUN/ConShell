/**
 * Minimal type declarations for Express.
 * @types/express is broken in locked node_modules — this provides
 * just enough typing for server.ts to compile.
 */
declare module 'express' {
    import type { IncomingMessage, ServerResponse } from 'node:http';

    interface Request {
        body: any;
        params: Record<string, string>;
        query: Record<string, string>;
        headers: Record<string, string | string[] | undefined>;
        method: string;
        url: string;
        path: string;
        setTimeout(msecs: number, callback?: () => void): this;
    }

    interface Response {
        status(code: number): Response;
        json(body: any): Response;
        send(body?: any): Response;
        sendFile(path: string, options?: any, fn?: (err?: Error) => void): void;
        set(field: string, value: string): Response;
        setHeader(name: string, value: string | number | readonly string[]): this;
        end(): void;
        writeHead(statusCode: number, headers?: Record<string, string>): this;
        write(chunk: any): boolean;
        headersSent: boolean;
        setTimeout(msecs: number, callback?: () => void): this;
    }

    interface NextFunction {
        (err?: any): void;
    }

    type RequestHandler = (req: Request, res: Response, next: NextFunction) => void;

    interface Router {
        get(path: string, ...handlers: RequestHandler[]): Router;
        post(path: string, ...handlers: RequestHandler[]): Router;
        put(path: string, ...handlers: RequestHandler[]): Router;
        delete(path: string, ...handlers: RequestHandler[]): Router;
        use(...handlers: (RequestHandler | string)[]): Router;
    }

    type ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => void;

    interface Application extends Router {
        (req: IncomingMessage, res: ServerResponse): void;
        listen(port: number, callback?: () => void): any;
        use(handler: RequestHandler): this;
        use(handler: ErrorRequestHandler): this;
        use(path: string, handler: RequestHandler): this;
        use(path: string, ...handlers: RequestHandler[]): this;
    }

    function express(): Application;

    namespace express {
        function json(): RequestHandler;
        function urlencoded(options?: { extended?: boolean }): RequestHandler;
        function Router(): Router;
        function static(root: string, options?: any): RequestHandler;
    }

    export = express;
}
