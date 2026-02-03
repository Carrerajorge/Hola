import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  const indexPath = path.resolve(distPath, "index.html");
  const indexTemplate = fs.readFileSync(indexPath, "utf-8");

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    const nonce = res.locals.cspNonce as string | undefined;
    if (!nonce) {
      res.sendFile(indexPath);
      return;
    }

    const withNonce = indexTemplate
      .replace(/<script(?![^>]*nonce=)/g, `<script nonce="${nonce}"`)
      .replace(/<style(?![^>]*nonce=)/g, `<style nonce="${nonce}"`);

    res.type("html").send(withNonce);
  });
}
