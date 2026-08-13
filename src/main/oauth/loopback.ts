import http from 'node:http';
import { shell } from 'electron';

const LOOPBACK_HOST = 'localhost';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML =
  '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<h2>Authentication complete! You can close this window.</h2></body></html>';

const ERROR_HTML =
  '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<h2>Authentication failed. Please close this window and try again.</h2></body></html>';

export class OAuthCancelledError extends Error {
  constructor() {
    super('Previous login attempt was cancelled by a newer attempt.');
    this.name = 'OAuthCancelledError';
  }
}

interface ActiveFlow {
  server: http.Server;
  fail: (err: Error) => void;
}
let activeFlow: ActiveFlow | null = null;

export function abortActiveOAuthFlow(): void {
  if (activeFlow) {
    try { activeFlow.server.close(); } catch { }
    try { activeFlow.fail(new OAuthCancelledError()); } catch { }
    activeFlow = null;
  }
}

function resolveRedirectUri(server: http.Server): string {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  return `http://${LOOPBACK_HOST}:${port}/oauth/callback`;
}

export interface LoopbackCode {
  code: string;
  redirectUri: string;
}

export async function runLoopbackOAuthFlow(
  buildAuthUrl: (redirectUri: string) => Promise<string>,
  timeoutMessage: string
): Promise<LoopbackCode> {
  return new Promise<LoopbackCode>((resolve, reject) => {
    abortActiveOAuthFlow();
    const server = http.createServer();
    let settled = false;
    let callbackReceived = false;
    let timeout: NodeJS.Timeout | undefined;
    let redirectUri = '';

    const cleanup = () => {
      if (activeFlow?.server === server) activeFlow = null;
      server.close();
      if (timeout) clearTimeout(timeout);
    };

    const fail = (err: Error) => {
      if (settled || callbackReceived) return;
      settled = true;
      cleanup();
      reject(err);
    };
    activeFlow = { server, fail };

    server.on('request', (req, res) => {
      const reqUrl = new URL(req.url || '/', redirectUri);
      const callbackPath = new URL(redirectUri).pathname;
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(204);
        res.end();
        return;
      }

      callbackReceived = true;
      const code = reqUrl.searchParams.get('code');
      const errParam = reqUrl.searchParams.get('error');

      res.setHeader('content-type', 'text/html');
      res.end(code ? SUCCESS_HTML : ERROR_HTML);

      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);

      if (!code) {
        cleanup();
        reject(new Error(
          errParam === 'access_denied'
            ? 'You cancelled the sign-in in the browser.'
            : 'No code found in callback URL'
        ));
        return;
      }

      cleanup();
      resolve({ code, redirectUri });
    });

    server.listen(0, LOOPBACK_HOST, async () => {
      try {
        redirectUri = resolveRedirectUri(server);
        console.log('[OAuth] redirect URI:', redirectUri);
        const authUrl = await buildAuthUrl(redirectUri);
        await shell.openExternal(authUrl);
      } catch (e) {
        fail(e as Error);
      }
    });

    timeout = setTimeout(() => fail(new Error(timeoutMessage)), CALLBACK_TIMEOUT_MS);

    server.on('error', (err: NodeJS.ErrnoException) => {
      fail(err);
    });
  });
}
