import "dotenv/config";
import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { runAgent } from "./agent.js";

const PORT = process.env.PORT || 3001;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const ALLOWED_IMAGES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_HISTORY = 20;

export function createApp({ ai = null, model = MODEL } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, model, apiKey: Boolean(ai) }));

  app.post("/api/chat", async (req, res) => {
    if (!ai) {
      return res.status(500).json({ error: "Clé GEMINI_API_KEY manquante dans server/.env" });
    }
    const { message = "", history = [], image } = req.body ?? {};
    if (!message.trim() && !image) {
      return res.status(400).json({ error: "Message vide." });
    }
    if (image) {
      if (!ALLOWED_IMAGES.includes(image.mimeType) || typeof image.data !== "string") {
        return res.status(400).json({ error: "Format d'image non pris en charge (JPEG, PNG ou WebP)." });
      }
      if (Buffer.byteLength(image.data, "base64") > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: "Image trop lourde (5 Mo maximum)." });
      }
    }
    const cleanHistory = (Array.isArray(history) ? history : [])
      .filter((m) => m && typeof m.text === "string" && ["user", "assistant"].includes(m.role))
      .slice(-MAX_HISTORY);

    try {
      const result = await runAgent({ ai, model, history: cleanHistory, message: message.trim(), image });
      res.json(result);
    } catch (err) {
      console.error("Gemini error:", err);
      const status = err.status === 429 ? 429 : 502;
      res.status(status).json({
        error: status === 429
          ? "Trop de requêtes vers Gemini, réessaie dans une minute."
          : "Le service IA n'a pas répondu. Vérifie la clé API et le nom du modèle.",
      });
    }
  });

  // In production, serve the built React app
  const dist = fileURLToPath(new URL("../../client/dist", import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${dist}/index.html`));
  }
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  if (!ai) console.warn("⚠️  GEMINI_API_KEY absente : copie .env.example en .env et ajoute ta clé.");
  createApp({ ai }).listen(PORT, () => console.log(`Bechra API sur http://localhost:${PORT} (modèle : ${MODEL})`));
}
