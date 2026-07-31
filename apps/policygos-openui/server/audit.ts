import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEvent {
  timestamp: string;
  requestId: string;
  subject: string;
  action: string;
  status: number;
  durationMs: number;
}

export function createAuditWriter(path: string) {
  return async (event: AuditEvent): Promise<void> => {
    const line = `${JSON.stringify(event)}\n`;
    if (!path) {
      console.info(line.trim());
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
  };
}
