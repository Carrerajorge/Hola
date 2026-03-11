import { pdfjs } from "react-pdf";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const PDF_WORKER_SRC = pdfWorkerSrc;

let pdfJsDistPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export function configurePdfJsWorker(): string {
  if (pdfjs.GlobalWorkerOptions.workerSrc !== PDF_WORKER_SRC) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  }

  return PDF_WORKER_SRC;
}

export async function loadPdfJsDist(): Promise<typeof import("pdfjs-dist")> {
  configurePdfJsWorker();

  if (!pdfJsDistPromise) {
    pdfJsDistPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
      return module;
    });
  }

  return pdfJsDistPromise;
}
