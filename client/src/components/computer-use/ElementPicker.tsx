/**
 * Element Picker - Visual selector tool for browser screenshots
 *
 * Click anywhere on a browser screenshot to identify the DOM element
 * at that position and get its CSS selector, tag, text, and attributes.
 */

import { useState, useCallback, useRef, MouseEvent } from "react";

interface PickedElement {
  selector: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface ElementPickerProps {
  screenshot: string | null;
  sessionId: string | null;
  onElementPicked?: (element: PickedElement) => void;
  onSelectorCopied?: (selector: string) => void;
  className?: string;
}

export function ElementPicker({
  screenshot,
  sessionId,
  onElementPicked,
  onSelectorCopied,
  className = "",
}: ElementPickerProps) {
  const [pickerActive, setPickerActive] = useState(false);
  const [pickedElement, setPickedElement] = useState<PickedElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlightedScreenshot, setHighlightedScreenshot] = useState<string | null>(null);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleImageClick = useCallback(
    async (e: MouseEvent<HTMLImageElement>) => {
      if (!pickerActive || !sessionId || !imgRef.current) return;

      const rect = imgRef.current.getBoundingClientRect();
      const scaleX = imgRef.current.naturalWidth / rect.width;
      const scaleY = imgRef.current.naturalHeight / rect.height;

      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      setCrosshair({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setLoading(true);

      try {
        // Call the browser control API to pick element
        const res = await fetch(`/api/browser-control/sessions/${sessionId}/element-at-point`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x, y }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.element) {
            setPickedElement(data.element);
            onElementPicked?.(data.element);

            // Highlight the element
            const highlightRes = await fetch(
              `/api/browser-control/sessions/${sessionId}/highlight`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  highlights: [
                    {
                      selector: data.element.selector,
                      label: data.element.tag,
                      color: "#3b82f6",
                    },
                  ],
                }),
              }
            );

            if (highlightRes.ok) {
              const highlightData = await highlightRes.json();
              if (highlightData.screenshot) {
                setHighlightedScreenshot(highlightData.screenshot);
              }
            }
          }
        }
      } catch (error) {
        console.error("Element pick error:", error);
      } finally {
        setLoading(false);
      }
    },
    [pickerActive, sessionId, onElementPicked]
  );

  const handleImageMove = useCallback(
    (e: MouseEvent<HTMLImageElement>) => {
      if (!pickerActive || !imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      setCrosshair({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [pickerActive]
  );

  const copySelector = useCallback(() => {
    if (!pickedElement) return;
    navigator.clipboard.writeText(pickedElement.selector);
    onSelectorCopied?.(pickedElement.selector);
  }, [pickedElement, onSelectorCopied]);

  const displayScreenshot = highlightedScreenshot || screenshot;

  if (!displayScreenshot) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 text-gray-500 ${className}`}>
        No screenshot available
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800">
        <button
          onClick={() => {
            setPickerActive(!pickerActive);
            if (pickerActive) {
              setHighlightedScreenshot(null);
              setCrosshair(null);
            }
          }}
          className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${
            pickerActive
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {pickerActive ? "Picker Active" : "Enable Picker"}
        </button>

        {pickedElement && (
          <>
            <div className="flex-1 text-xs font-mono text-gray-400 truncate px-2">
              {pickedElement.selector}
            </div>
            <button
              onClick={copySelector}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded"
            >
              Copy Selector
            </button>
          </>
        )}
      </div>

      {/* Screenshot with picker overlay */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <img
          ref={imgRef}
          src={displayScreenshot}
          alt="Browser"
          className={`w-full h-full object-contain ${
            pickerActive ? "cursor-crosshair" : "cursor-default"
          }`}
          onClick={handleImageClick}
          onMouseMove={handleImageMove}
          onMouseLeave={() => !pickedElement && setCrosshair(null)}
          draggable={false}
        />

        {/* Crosshair overlay */}
        {pickerActive && crosshair && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className="absolute w-px bg-blue-400/50"
              style={{
                left: crosshair.x,
                top: 0,
                height: "100%",
              }}
            />
            <div
              className="absolute h-px bg-blue-400/50"
              style={{
                top: crosshair.y,
                left: 0,
                width: "100%",
              }}
            />
            <div
              className="absolute w-2 h-2 bg-blue-500 rounded-full -translate-x-1 -translate-y-1"
              style={{
                left: crosshair.x,
                top: crosshair.y,
              }}
            />
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="text-white text-sm">Identifying element...</div>
          </div>
        )}
      </div>

      {/* Element info panel */}
      {pickedElement && (
        <div className="px-3 py-2 bg-gray-900 border-t border-gray-800 max-h-40 overflow-y-auto">
          <div className="space-y-1 text-xs font-mono">
            <div className="flex gap-2">
              <span className="text-gray-400">Tag:</span>
              <span className="text-blue-400">{`<${pickedElement.tag}>`}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-400">Selector:</span>
              <span className="text-green-400 break-all">{pickedElement.selector}</span>
            </div>
            {pickedElement.text && (
              <div className="flex gap-2">
                <span className="text-gray-400">Text:</span>
                <span className="text-gray-300 truncate">{pickedElement.text}</span>
              </div>
            )}
            {Object.keys(pickedElement.attributes).length > 0 && (
              <div>
                <span className="text-gray-400">Attrs:</span>
                <div className="ml-4">
                  {Object.entries(pickedElement.attributes)
                    .slice(0, 8)
                    .map(([k, v]) => (
                      <div key={k} className="text-gray-300">
                        <span className="text-purple-400">{k}</span>
                        <span className="text-gray-500">=</span>
                        <span className="text-yellow-400">"{v.slice(0, 60)}"</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-gray-400">Box:</span>
              <span className="text-gray-300">
                {pickedElement.boundingBox.width}x{pickedElement.boundingBox.height} @{" "}
                ({pickedElement.boundingBox.x}, {pickedElement.boundingBox.y})
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
