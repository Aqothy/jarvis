/**
 * Google Calendar service
 * Provides access to Google Calendar events
 * Requires OAuth2 authentication with Google Calendar API
 */

import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  isAllDay: boolean;
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

function getCalendarCredentials(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/oauth2callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set. See README for setup instructions.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function getTokenPath(): string {
  return join(app.getPath("userData"), "google-calendar-token.json");
}

async function loadToken(): Promise<TokenData | null> {
  const tokenPath = getTokenPath();
  if (!existsSync(tokenPath)) {
    return null;
  }

  try {
    const tokenContent = await readFile(tokenPath, "utf-8");
    return JSON.parse(tokenContent) as TokenData;
  } catch {
    return null;
  }
}

async function saveToken(token: TokenData): Promise<void> {
  const tokenPath = getTokenPath();
  const tokenDir = join(app.getPath("userData"));
  await mkdir(tokenDir, { recursive: true });
  await writeFile(tokenPath, JSON.stringify(token, null, 2), "utf-8");
}

function createOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getCalendarCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getAuthenticatedClient(): Promise<calendar_v3.Calendar> {
  const oauth2Client = createOAuth2Client();
  const token = await loadToken();

  if (!token) {
    throw new Error(
      "Not authenticated with Google Calendar. Connect in Settings or run /auth-calendar first.",
    );
  }

  oauth2Client.setCredentials(token);

  // Set up automatic token refresh
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.refresh_token) {
      const updatedToken: TokenData = {
        ...token,
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date!,
      };
      await saveToken(updatedToken);
    } else if (tokens.access_token) {
      const updatedToken: TokenData = {
        ...token,
        access_token: tokens.access_token,
        expiry_date: tokens.expiry_date!,
      };
      await saveToken(updatedToken);
    }
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

function formatDateTime(dateTime: string | null | undefined, isAllDay: boolean): string {
  if (!dateTime) {
    return "Unknown time";
  }

  try {
    const date = new Date(dateTime);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const isTomorrow =
      date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getDate() === tomorrow.getDate();

    if (isAllDay) {
      if (isToday) return "Today";
      if (isTomorrow) return "Tomorrow";
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    if (isToday) return `Today at ${timeStr}`;
    if (isTomorrow) return `Tomorrow at ${timeStr}`;

    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateTime;
  }
}

export class CalendarService {
  /**
   * Get the OAuth2 authorization URL for user authentication
   */
  static getAuthUrl(): string {
    const oauth2Client = createOAuth2Client();
    const scopes = ["https://www.googleapis.com/auth/calendar.readonly"];

    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  static async authenticateWithCode(code: string): Promise<void> {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Failed to obtain access tokens from Google");
    }

    const tokenData: TokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope || "",
      token_type: tokens.token_type || "Bearer",
      expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
    };

    await saveToken(tokenData);
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    const token = await loadToken();
    return token !== null;
  }

  /**
   * List upcoming events from Google Calendar
   * @param maxResults Maximum number of events to return (default: 10)
   * @param timeMin Start time for events (default: now)
   * @param timeMax End time for events (optional)
   */
  static async listUpcomingEvents(
    maxResults: number = 10,
    timeMin?: Date,
    timeMax?: Date,
  ): Promise<CalendarEvent[]> {
    const calendar = await getAuthenticatedClient();

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: (timeMin || new Date()).toISOString(),
      timeMax: timeMax?.toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];

    return events.map((event) => {
      const isAllDay = !!event.start?.date;
      return {
        id: event.id || "",
        summary: event.summary || "No title",
        start: event.start?.dateTime || event.start?.date || "",
        end: event.end?.dateTime || event.end?.date || "",
        location: event.location,
        description: event.description,
        isAllDay,
      };
    });
  }

  /**
   * Get today's events
   */
  static async getTodayEvents(): Promise<CalendarEvent[]> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    return this.listUpcomingEvents(20, startOfDay, endOfDay);
  }

  /**
   * Get this week's events
   */
  static async getWeekEvents(): Promise<CalendarEvent[]> {
    const startOfWeek = new Date();
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    endOfWeek.setHours(23, 59, 59, 999);

    return this.listUpcomingEvents(50, startOfWeek, endOfWeek);
  }

  /**
   * Format calendar events as a human-readable string
   */
  static formatEvents(events: CalendarEvent[], timeframe: string = "upcoming"): string {
    if (events.length === 0) {
      return `No ${timeframe} events found.`;
    }

    const lines: string[] = [`${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)} events:`];

    for (const event of events) {
      const startTime = formatDateTime(event.start, event.isAllDay);
      let eventLine = `• ${event.summary} - ${startTime}`;

      if (event.location) {
        eventLine += ` at ${event.location}`;
      }

      lines.push(eventLine);
    }

    return lines.join("\n");
  }
}
