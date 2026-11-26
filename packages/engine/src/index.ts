export * from "./events.ts";
export * from "./handoffs.ts";
export * from "./models.ts";
export * from "./reply.ts";
export * from "./router.ts";
export * from "./runner.ts";
export * from "./tools/index.ts";
export * from "./work.ts";

/** Job names and payloads shared by the web app (producer) and the worker. */
export const JOBS = {
  runRequest: "request-run",
  roomReply: "room-reply",
} as const;

export interface RunRequestJob {
  requestId: string;
  feedback?: string;
}

export interface RoomReplyJob {
  messageId: string;
  agentId: string;
}
