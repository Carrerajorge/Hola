export function autosizeTextarea(
  textarea: HTMLTextAreaElement | null | undefined,
  maxHeight: number,
): void {
  if (!textarea) return;

  textarea.style.height = "auto";

  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}
