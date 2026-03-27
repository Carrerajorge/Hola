import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/hooks/use-chats";

import { AssistantMessage } from "./AssistantMessage";

vi.mock("@/stores/super-agent-store", () => ({
  useSuperAgentRun: () => null,
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  usePlatformSettings: () => ({
    settings: {
      timezone_default: "America/La_Paz",
    },
  }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettingsContext: () => ({
    settings: {
      codeInterpreter: false,
    },
  }),
}));

vi.mock("./MessageParts", () => ({
  parseDocumentBlocks: (content: string) => ({ text: content, documents: [] }),
  extractCodeBlocks: (content: string) => [{ type: "markdown", content }],
  formatMessageTime: () => "22:45",
  CleanDataTableComponents: {},
  AttachmentList: () => null,
  ActionToolbar: ({ content }: { content: string }) => (
    <div data-testid="mock-action-toolbar">{content}</div>
  ),
}));

vi.mock("./AgentRunContent", () => ({
  AgentRunContent: () => <div data-testid="mock-agent-run">agent run</div>,
}));

vi.mock("@/components/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
  MarkdownErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/uncertainty-badge", () => ({
  UncertaintyBadge: () => null,
}));

vi.mock("@/components/ui/verification-badge", () => ({
  VerificationBadge: () => null,
}));

vi.mock("@/components/super-agent-display", () => ({
  SuperAgentDisplay: () => null,
}));

vi.mock("@/components/retrieval-vis", () => ({
  RetrievalVis: () => null,
}));

vi.mock("@/components/news-cards", () => ({
  NewsCards: () => <div data-testid="mock-news-cards">news cards</div>,
}));

vi.mock("@/components/code-execution-block", () => ({
  CodeExecutionBlock: () => null,
}));

vi.mock("@/components/DocumentAnalysisResults", () => ({
  DocumentAnalysisResults: () => null,
}));

vi.mock("@/components/artifact-viewer", () => ({
  ArtifactViewer: () => null,
}));

vi.mock("@/components/figma-block", () => ({
  FigmaBlock: () => null,
}));

vi.mock("@/components/inline-google-form-preview", () => ({
  InlineGoogleFormPreview: () => null,
}));

vi.mock("@/components/inline-gmail-preview", () => ({
  InlineGmailPreview: () => null,
}));

vi.mock("@/components/sources-panel", () => ({
  SourcesPanel: () => null,
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    timestamp: new Date("2026-03-21T22:45:00Z"),
    ...overrides,
  };
}

describe("AssistantMessage", () => {
  it("shows the action toolbar when content comes from agent summary", () => {
    render(
      <AssistantMessage
        message={makeMessage({
          agentRun: {
            runId: "run-1",
            status: "completed",
            userMessage: "de que trata este documento?",
            steps: [],
            eventStream: [],
            summary: "Tema principal del documento.",
            error: null,
          },
        })}
        msgIndex={1}
        totalMessages={2}
        variant="default"
        copiedMessageId={null}
        messageFeedback={{}}
        speakingMessageId={null}
        aiState="idle"
        isRegenerating={false}
        isGeneratingImage={false}
        pendingGeneratedImage={null}
        latestGeneratedImageRef={{ current: null }}
        onCopyMessage={vi.fn()}
        onFeedback={vi.fn()}
        onRegenerate={vi.fn()}
        onShare={vi.fn()}
        onReadAloud={vi.fn()}
        onOpenDocumentPreview={vi.fn()}
        onOpenFileAttachmentPreview={vi.fn()}
        onDownloadImage={vi.fn()}
        onOpenLightbox={vi.fn()}
      />,
    );

    expect(screen.getByTestId("mock-agent-run")).toBeInTheDocument();
    expect(screen.getByTestId("mock-action-toolbar")).toHaveTextContent(
      "Tema principal del documento.",
    );
  });

  it("renders the response content before related news cards", () => {
    render(
      <AssistantMessage
        message={makeMessage({
          content: "Respuesta final",
          webSources: [
            {
              url: "https://example.com/noticia",
              title: "Noticia",
              domain: "example.com",
            },
          ],
        })}
        msgIndex={1}
        totalMessages={2}
        variant="default"
        copiedMessageId={null}
        messageFeedback={{}}
        speakingMessageId={null}
        aiState="idle"
        isRegenerating={false}
        isGeneratingImage={false}
        pendingGeneratedImage={null}
        latestGeneratedImageRef={{ current: null }}
        onCopyMessage={vi.fn()}
        onFeedback={vi.fn()}
        onRegenerate={vi.fn()}
        onShare={vi.fn()}
        onReadAloud={vi.fn()}
        onOpenDocumentPreview={vi.fn()}
        onOpenFileAttachmentPreview={vi.fn()}
        onDownloadImage={vi.fn()}
        onOpenLightbox={vi.fn()}
      />,
    );

    const content = document.querySelector(".prose");
    const newsCards = screen.getByTestId("mock-news-cards");

    expect(content).not.toBeNull();
    expect(content?.compareDocumentPosition(newsCards)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("renders a failed response health card without duplicating the fallback body", () => {
    render(
      <AssistantMessage
        message={makeMessage({
          content: "No se pudo completar esta respuesta.",
          metadata: {
            responseHealth: {
              state: "failed",
              retryable: true,
              reason: "No se pudo completar esta respuesta.",
              detail: "Gateway timeout",
              provider: "openai",
            },
          },
        })}
        msgIndex={1}
        totalMessages={2}
        variant="default"
        copiedMessageId={null}
        messageFeedback={{}}
        speakingMessageId={null}
        aiState="idle"
        isRegenerating={false}
        isGeneratingImage={false}
        pendingGeneratedImage={null}
        latestGeneratedImageRef={{ current: null }}
        onCopyMessage={vi.fn()}
        onFeedback={vi.fn()}
        onRegenerate={vi.fn()}
        onShare={vi.fn()}
        onReadAloud={vi.fn()}
        onOpenDocumentPreview={vi.fn()}
        onOpenFileAttachmentPreview={vi.fn()}
        onDownloadImage={vi.fn()}
        onOpenLightbox={vi.fn()}
      />,
    );

    expect(screen.getByText("No se pudo completar")).toBeInTheDocument();
    expect(
      screen.getAllByText("No se pudo completar esta respuesta."),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /Reintentar/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ver detalle/i }));

    expect(screen.getByText("Gateway timeout")).toBeInTheDocument();
  });
});
