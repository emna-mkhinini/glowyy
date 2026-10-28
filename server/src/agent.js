import { functionDeclarations, toolImplementations } from "./tools.js";

export const SYSTEM_PROMPT = `Tu es Bechra, une assistante skincare bienveillante spécialisée dans le soin du visage.

Ta mission : aider la personne à comprendre sa peau et à construire une routine simple et adaptée.

Règles :
- Réponds dans la langue de la personne (français, arabe ou derja tunisienne), avec un ton chaleureux et clair.
- Si le type de peau ou les préoccupations ne sont pas connus, pose une ou deux questions courtes avant de proposer une routine.
- Utilise tes outils plutôt que ta mémoire : build_skincare_routine pour une routine, get_ingredient_info pour un ingrédient, check_ingredient_compatibility quand plusieurs actifs sont cités, check_warning_signs dès qu'une lésion, une douleur, un grain de beauté, une infection ou une réaction est décrite.
- Sur une photo, décris uniquement ce qui est visible (brillance, rougeurs, imperfections, pores, sécheresse apparente) avec prudence, sans jamais poser de diagnostic médical ni commenter l'apparence physique de la personne.
- Tu ne poses pas de diagnostic et ne recommandes pas de médicaments sur ordonnance. Oriente vers un dermatologue quand c'est nécessaire.
- Recommande des types de produits et des ingrédients, pas des marques.
- Réponses courtes et structurées (titres courts, listes), en Markdown.`;

const MAX_STEPS = 5;

/**
 * Runs one agent turn: sends the conversation to Gemini, executes the tools it asks for,
 * and loops until the model answers with text.
 * @param {object} p
 * @param {object} p.ai        GoogleGenAI client (or a stub with models.generateContent)
 * @param {string} p.model
 * @param {{role:'user'|'assistant', text:string}[]} p.history  previous turns (text only)
 * @param {string} p.message
 * @param {{mimeType:string, data:string}} [p.image]  base64 image for this turn
 */
export async function runAgent({ ai, model, history = [], message, image }) {
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  const userParts = [];
  if (image) userParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  userParts.push({ text: message || "Voici une photo de ma peau. Que peux-tu observer ?" });
  contents.push({ role: "user", parts: userParts });

  const config = {
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations }],
    temperature: 0.6,
  };

  const toolsUsed = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await ai.models.generateContent({ model, contents, config });
    const calls = response.functionCalls ?? [];

    if (calls.length === 0) {
      return { reply: response.text ?? "", toolsUsed };
    }

    contents.push(response.candidates[0].content);
    const results = calls.map((fc) => {
      const impl = toolImplementations[fc.name];
      let output;
      try {
        output = impl ? impl(fc.args ?? {}) : { error: `Outil inconnu : ${fc.name}` };
      } catch (err) {
        output = { error: err.message };
      }
      toolsUsed.push({ name: fc.name, args: fc.args ?? {} });
      return { functionResponse: { id: fc.id, name: fc.name, response: output } };
    });
    contents.push({ role: "user", parts: results });
  }

  return {
    reply: "Désolée, je n'ai pas réussi à finaliser ma réponse. Peux-tu reformuler ta question ?",
    toolsUsed,
  };
}
