export type TimelineContentFormat = "json" | "markdown" | "text";

export type TimelineMessageView = {
  at: number;
  content: string;
  contentFormat: TimelineContentFormat;
  floorId: string;
  floorNo: number;
  floorState: string;
  id: string;
  pageId: string;
  role: "assistant" | "narrator" | "system" | "user";
  seq: number;
  tokenIn: number;
  tokenOut: number;
};
