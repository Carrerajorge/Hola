export type RequestUnderstandingInput = {
  text: string;
  attachments?: Array<{ type: "document" | "image"; name?: string; extractedText: string }>;
  userId?: string;
  requestId?: string;
};

