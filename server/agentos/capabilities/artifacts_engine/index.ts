import { z } from "zod";

export type ArtifactType = "code" | "html" | "svg" | "markdown" | "react";

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
}

export class ArtifactsEngine {
  
  getSystemPromptInjection(): string {
    return `
[ARTIFACTS ENABLED]
You can generate interactive content (HTML, React, SVG, Mermaid diagrams).
To do this, use standard markdown code blocks but prepend a special comment line.

Format for HTML/React:
\`\`\`html
<!-- artifact: type="html" title="Dashboard View" -->
<!DOCTYPE html>...
\`\`\`

Format for SVG:
\`\`\`svg
<!-- artifact: type="svg" title="Architecture Diagram" -->
<svg>...
\`\`\`

The frontend will automatically render these blocks as interactive previews. Use this for ANY visual output requested by the user.`;
  }
}
