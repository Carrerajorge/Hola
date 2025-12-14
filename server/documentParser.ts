export async function extractText(content: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "text/plain") {
    return content.toString("utf-8");
  }
  
  if (mimeType === "text/markdown" || mimeType === "text/md") {
    return content.toString("utf-8");
  }

  if (mimeType === "application/json") {
    try {
      const json = JSON.parse(content.toString("utf-8"));
      return JSON.stringify(json, null, 2);
    } catch {
      return content.toString("utf-8");
    }
  }

  if (mimeType === "text/csv") {
    return content.toString("utf-8");
  }

  if (mimeType === "text/html") {
    const html = content.toString("utf-8");
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  return content.toString("utf-8");
}
