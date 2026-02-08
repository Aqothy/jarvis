import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DesktopOrganizerResult {
  moved: number;
  skippedConflicts: number;
  totalSeen: number;
  rawOutput: string;
}

function resolveOrganizerScriptPath(): string {
  const candidates = [
    join(process.cwd(), "scripts", "organize-desktop.sh"),
    join(app.getAppPath(), "scripts", "organize-desktop.sh"),
    join(__dirname, "../../../scripts/organize-desktop.sh"),
    join(__dirname, "../../scripts/organize-desktop.sh"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Desktop organizer script not found.");
}

function parseSummaryMetric(stdout: string, key: string): number {
  const pattern = new RegExp(`^${key}=(\\d+)$`, "m");
  const match = stdout.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Desktop organizer output missing metric: ${key}`);
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Desktop organizer metric is invalid: ${key}`);
  }

  return parsed;
}

export async function organizeDesktopByFileType(): Promise<DesktopOrganizerResult> {
  const scriptPath = resolveOrganizerScriptPath();
  const execution = await execFileAsync("bash", [scriptPath], {
    encoding: "utf8",
  });
  const stdout = execution.stdout.trim();

  return {
    moved: parseSummaryMetric(stdout, "SUMMARY_MOVED"),
    skippedConflicts: parseSummaryMetric(stdout, "SUMMARY_SKIPPED_CONFLICTS"),
    totalSeen: parseSummaryMetric(stdout, "SUMMARY_TOTAL_SEEN"),
    rawOutput: stdout,
  };
}
