/**
 * Google Calendar OAuth2 authentication helper
 * Provides utilities for handling OAuth flow
 */

import { shell } from "electron";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CalendarService } from "./calendar-service";

interface AuthResult {
  success: boolean;
  error?: string;
}

/**
 * Start OAuth flow by opening browser
 */
export async function startCalendarAuth(): Promise<void> {
  const authUrl = CalendarService.getAuthUrl();
  await shell.openExternal(authUrl);
}

/**
 * Start a local server to handle OAuth callback
 * Returns a promise that resolves when authentication is complete
 */
export async function handleCalendarAuthCallback(
  port: number = 3000,
): Promise<AuthResult> {
  return new Promise((resolve) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url) {
          res.writeHead(400);
          res.end("Bad request");
          return;
        }

        const url = new URL(req.url, `http://localhost:${port}`);

        if (url.pathname === "/oauth2callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Authentication Failed</title>
                  <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #d32f2f; }
                  </style>
                </head>
                <body>
                  <h1 class="error">Authentication Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            server.close();
            resolve({ success: false, error });
            return;
          }

          if (!code) {
            res.writeHead(400);
            res.end("Missing authorization code");
            server.close();
            resolve({ success: false, error: "Missing authorization code" });
            return;
          }

          try {
            await CalendarService.authenticateWithCode(code);

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Authentication Successful</title>
                  <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .success { color: #388e3c; }
                  </style>
                </head>
                <body>
                  <h1 class="success">✓ Authentication Successful</h1>
                  <p>You can now use Google Calendar features in Jarvis.</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);

            server.close();
            resolve({ success: true });
          } catch (authError) {
            const errorMessage =
              authError instanceof Error
                ? authError.message
                : "Unknown error";

            res.writeHead(500, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Authentication Error</title>
                  <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #d32f2f; }
                  </style>
                </head>
                <body>
                  <h1 class="error">Authentication Error</h1>
                  <p>${errorMessage}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);

            server.close();
            resolve({ success: false, error: errorMessage });
          }
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      },
    );

    server.listen(port, () => {
      console.log(`OAuth callback server listening on port ${port}`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      resolve({
        success: false,
        error: "Authentication timeout - please try again",
      });
    }, 5 * 60 * 1000);
  });
}

/**
 * Complete authentication flow
 * Opens browser and waits for callback
 */
export async function authenticateCalendar(): Promise<AuthResult> {
  try {
    // Start the callback server first
    const callbackPromise = handleCalendarAuthCallback(3000);

    // Wait a moment for server to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Open browser for authentication
    await startCalendarAuth();

    // Wait for callback
    return await callbackPromise;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
