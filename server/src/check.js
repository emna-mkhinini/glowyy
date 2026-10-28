// Quick diagnostic: `npm run check` tests the API key and the model in server/.env
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

if (!key) {
  console.error("❌ GEMINI_API_KEY introuvable dans server/.env");
  process.exit(1);
}
console.log(`Clé trouvée (${key.slice(0, 4)}…, ${key.length} caractères) — modèle : ${model}`);

const ai = new GoogleGenAI({ apiKey: key });
try {
  const res = await ai.models.generateContent({ model, contents: "Réponds juste : OK" });
  console.log("✅ Gemini répond :", res.text?.trim());
} catch (err) {
  console.error("❌ Erreur Gemini :", err.status ?? "", err.message);
  try {
    const pager = await ai.models.list();
    const names = [];
    for await (const m of pager) {
      if (m.supportedActions?.includes("generateContent") && /flash/.test(m.name)) names.push(m.name.replace("models/", ""));
    }
    if (names.length) console.log("Modèles Flash disponibles avec cette clé :", names.join(", "));
  } catch {
    console.log("Impossible de lister les modèles : la clé elle-même est probablement invalide.");
  }
  process.exit(1);
}
