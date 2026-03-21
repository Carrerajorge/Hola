import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionToolbar } from "./MessageParts";

describe("ActionToolbar", () => {
  it("renders a direct speaker button and reads the visible content", () => {
    const onReadAloud = vi.fn();

    render(
      <ActionToolbar
        messageId="msg-1"
        content="Resumen del documento"
        msgIndex={0}
        copiedMessageId={null}
        messageFeedback={{}}
        speakingMessageId={null}
        aiState="idle"
        isRegenerating={false}
        variant="default"
        onCopy={vi.fn()}
        onFeedback={vi.fn()}
        onRegenerate={vi.fn()}
        onShare={vi.fn()}
        onReadAloud={onReadAloud}
      />,
    );

    fireEvent.click(screen.getByTestId("button-read-aloud-main-msg-1"));

    expect(onReadAloud).toHaveBeenCalledWith("msg-1", "Resumen del documento");
  });
});
