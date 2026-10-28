import { readFileSync } from "node:fs";
import { Type } from "@google/genai";

const INGREDIENTS = JSON.parse(readFileSync(new URL("./data/ingredients.json", import.meta.url), "utf8"));

const SKIN_TYPES = ["grasse", "mixte", "normale", "sèche", "sensible"];
const CONCERNS = ["acne", "points_noirs", "pores", "brillance", "taches", "rides", "rougeurs",
  "deshydratation", "secheresse", "eclat", "texture"];

const normalize = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function findIngredient(query) {
  const q = normalize(query);
  if (!q) return null;
  return INGREDIENTS.find((i) => i.id === q || i.aliases.some((a) => normalize(a) === q))
    ?? INGREDIENTS.find((i) => i.aliases.some((a) => normalize(a).includes(q) || q.includes(normalize(a))))
    ?? null;
}

// ---------------------------------------------------------------- tool 1
function getIngredientInfo({ ingredient }) {
  const found = findIngredient(ingredient);
  if (!found) {
    return { found: false, message: `Ingrédient « ${ingredient} » absent de la base.`,
      available: INGREDIENTS.map((i) => i.name) };
  }
  const { aliases, ...info } = found;
  return { found: true, ...info };
}

// ---------------------------------------------------------------- tool 2
// Pairs that should not be applied in the same routine (same moment), with the advice to give.
const CONFLICTS = [
  [["retinol"], ["glycolic_acid", "lactic_acid", "salicylic_acid"], "high",
    "Trop irritant ensemble : alterner les soirs (ex. rétinol lundi/jeudi, acide mercredi/samedi)."],
  [["retinol"], ["benzoyl_peroxide"], "high",
    "Le peroxyde de benzoyle peut dégrader le rétinol et l'association irrite : peroxyde le matin ou en local, rétinol le soir."],
  [["vitamin_c"], ["glycolic_acid", "lactic_acid", "salicylic_acid"], "medium",
    "Risque d'irritation : vitamine C le matin, acides exfoliants le soir."],
  [["vitamin_c"], ["retinol"], "medium",
    "Pas dangereux, mais mieux séparés : vitamine C le matin, rétinol le soir."],
  [["vitamin_c"], ["benzoyl_peroxide"], "medium",
    "Le peroxyde de benzoyle oxyde la vitamine C : les utiliser à des moments différents."],
  [["glycolic_acid", "lactic_acid"], ["salicylic_acid"], "medium",
    "Risque de sur-exfoliation : ne pas cumuler le même soir, ou choisir un produit qui associe les deux à faible dose."],
  [["glycolic_acid"], ["lactic_acid"], "medium",
    "Deux AHA ensemble : sur-exfoliation possible, en garder un seul."],
];

function checkIngredientCompatibility({ ingredients }) {
  const list = (ingredients ?? []).map((q) => ({ query: q, item: findIngredient(q) }));
  const unknown = list.filter((x) => !x.item).map((x) => x.query);
  const known = list.filter((x) => x.item);
  const conflicts = [];
  for (let i = 0; i < known.length; i++) {
    for (let j = i + 1; j < known.length; j++) {
      const a = known[i].item.id, b = known[j].item.id;
      for (const [g1, g2, severity, advice] of CONFLICTS) {
        if ((g1.includes(a) && g2.includes(b)) || (g1.includes(b) && g2.includes(a))) {
          conflicts.push({ pair: [known[i].item.name, known[j].item.name], severity, advice });
        }
      }
    }
  }
  return {
    checked: known.map((x) => x.item.name),
    unknown,
    compatible: conflicts.length === 0,
    conflicts,
    note: conflicts.length === 0 && known.length > 1
      ? "Aucune incompatibilité connue entre ces ingrédients. Introduire un seul nouvel actif à la fois reste conseillé."
      : undefined,
  };
}

// ---------------------------------------------------------------- tool 3
const CLEANSER = {
  grasse: "Gel nettoyant doux (sans savon, pH physiologique)",
  mixte: "Gel nettoyant doux (sans savon)",
  normale: "Gel ou lait nettoyant doux",
  "sèche": "Lait ou crème lavante nourrissante",
  sensible: "Lait ou gel nettoyant très doux, sans parfum",
};
const MOISTURIZER = {
  grasse: "Gel-crème léger non comédogène",
  mixte: "Crème légère non comédogène",
  normale: "Crème hydratante",
  "sèche": "Crème riche aux céramides",
  sensible: "Crème apaisante aux céramides, sans parfum",
};
const SUNSCREEN = {
  grasse: "Crème solaire SPF 50 fluide, fini mat",
  mixte: "Crème solaire SPF 50 fluide",
  normale: "Crème solaire SPF 30 à 50",
  "sèche": "Crème solaire SPF 50 hydratante",
  sensible: "Crème solaire SPF 50 minérale, sans parfum",
};

function pickEveningActive(concerns, skin, pregnant) {
  const sensitive = skin === "sensible";
  const order = ["acne", "points_noirs", "rides", "taches", "texture", "rougeurs", "pores"];
  const main = order.find((c) => concerns.includes(c));
  switch (main) {
    case "acne":
    case "points_noirs":
      return sensitive || pregnant
        ? { id: "azelaic_acid", frequency: "Tous les soirs (un soir sur deux la première semaine)" }
        : { id: "salicylic_acid", frequency: "2 à 3 soirs par semaine au début, puis selon la tolérance" };
    case "rides":
      return sensitive || pregnant
        ? { id: "bakuchiol", frequency: "Tous les soirs" }
        : { id: "retinol", frequency: "2 soirs par semaine pendant un mois, puis 3 à 4" };
    case "taches":
      return { id: sensitive ? "azelaic_acid" : "alpha_arbutin", frequency: "Tous les soirs" };
    case "texture":
      return { id: sensitive || skin === "sèche" ? "lactic_acid" : "glycolic_acid", frequency: "1 à 2 soirs par semaine" };
    case "rougeurs":
      return { id: "centella", frequency: "Tous les soirs" };
    case "pores":
      return { id: "niacinamide", frequency: "Tous les soirs" };
    default:
      return null;
  }
}

function buildSkincareRoutine({ skin_type, concerns = [], pregnant = false, wears_makeup = false }) {
  const skin = SKIN_TYPES.includes(skin_type) ? skin_type : "normale";
  const cs = concerns.filter((c) => CONCERNS.includes(c));
  const sensitive = skin === "sensible";
  const name = (id) => findIngredient(id)?.name ?? id;

  // Morning serum: at most one active
  let morningActive = null;
  if ((cs.includes("taches") || cs.includes("eclat")) && !sensitive) morningActive = "vitamin_c";
  else if (["acne", "pores", "brillance", "rougeurs"].some((c) => cs.includes(c))) morningActive = "niacinamide";
  else if (cs.includes("deshydratation") || skin === "sèche") morningActive = "hyaluronic_acid";

  const evening = pickEveningActive(cs, skin, pregnant);

  const morning = [
    { step: 1, product: skin === "sèche" || sensitive ? "Eau micellaire ou simple rinçage à l'eau tiède" : CLEANSER[skin] },
    morningActive && { step: 2, product: `Sérum : ${name(morningActive)}`, active: name(morningActive) },
    { step: 3, product: MOISTURIZER[skin] },
    { step: 4, product: SUNSCREEN[skin], note: "Étape la plus importante de la routine" },
  ].filter(Boolean).map((s, i) => ({ ...s, step: i + 1 }));

  const night = [
    (wears_makeup) && { product: "Démaquillant (huile ou baume démaquillant, ou eau micellaire)" },
    { product: CLEANSER[skin] },
    evening && { product: `Traitement : ${name(evening.id)}`, active: name(evening.id), frequency: evening.frequency },
    (cs.includes("deshydratation") && morningActive !== "hyaluronic_acid") && { product: "Sérum : Acide hyaluronique" },
    { product: MOISTURIZER[skin] },
    (skin === "sèche") && { product: "Quelques gouttes de squalane (optionnel)" },
  ].filter(Boolean).map((s, i) => ({ step: i + 1, ...s }));

  const actives = [morningActive, evening?.id].filter(Boolean);
  const compat = actives.length > 1 ? checkIngredientCompatibility({ ingredients: actives }) : null;

  const tips = [
    "Introduire un seul nouveau produit à la fois, toutes les 2 semaines.",
    "Faire un test sur une petite zone (derrière l'oreille) 24 h avant.",
    "Compter 6 à 8 semaines pour juger des résultats.",
  ];
  if (actives.some((a) => ["retinol", "glycolic_acid", "lactic_acid", "salicylic_acid"].includes(a))) {
    tips.push("Cet actif rend la peau plus sensible au soleil : crème solaire chaque matin, même à l'intérieur près d'une fenêtre.");
  }
  if (pregnant) tips.push("Grossesse : rétinoïdes exclus de la routine ; valider chaque actif avec un médecin.");

  return { skin_type: skin, concerns: cs, morning, night, compatibility: compat, tips };
}

// ---------------------------------------------------------------- tool 4
const RED_FLAGS = [
  { keys: ["grain de beaute", "nevus", "mole", "tache qui change", "tache qui grossit", "saigne", "bord irregulier"],
    reason: "Un grain de beauté ou une tache qui change, grossit, saigne ou a des bords irréguliers doit être vu par un dermatologue.", urgency: "rapide" },
  { keys: ["ne guerit pas", "ne cicatrise pas", "plaie", "croute qui revient"],
    reason: "Une lésion qui ne guérit pas en quelques semaines doit être examinée.", urgency: "rapide" },
  { keys: ["kyste", "kystique", "nodule", "acne severe", "cicatrice", "boutons douloureux"],
    reason: "L'acné nodulaire ou kystique, ou qui laisse des cicatrices, relève d'un traitement médical.", urgency: "consultation" },
  { keys: ["fievre", "pus", "chaud", "gonfle", "infection", "douleur forte"],
    reason: "Des signes d'infection (chaleur, gonflement, pus, fièvre) nécessitent un avis médical.", urgency: "rapide" },
  { keys: ["levres gonflees", "visage gonfle", "respirer", "gorge", "urticaire"],
    reason: "Un gonflement du visage ou une gêne pour respirer peut être une réaction allergique grave : appeler les urgences (190 en Tunisie).", urgency: "urgence" },
  { keys: ["brulure", "brule", "plaques rouges", "eczema", "psoriasis", "demangeaisons"],
    reason: "Des plaques persistantes, des démangeaisons ou une brûlure chimique méritent un avis médical.", urgency: "consultation" },
];

function checkWarningSigns({ symptoms }) {
  const text = normalize(symptoms);
  const matched = RED_FLAGS.filter((f) => f.keys.some((k) => text.includes(k)));
  const rank = { urgence: 3, rapide: 2, consultation: 1 };
  const urgency = matched.reduce((best, f) => (rank[f.urgency] > (rank[best] ?? 0) ? f.urgency : best), null);
  return {
    see_doctor: matched.length > 0,
    urgency: urgency ?? "aucune",
    reasons: matched.map((f) => f.reason),
    reminder: "Bechra ne pose pas de diagnostic. En cas de doute, consulter un dermatologue.",
  };
}

// ---------------------------------------------------------------- declarations
export const functionDeclarations = [
  {
    name: "get_ingredient_info",
    description: "Donne les bienfaits, le type de peau adapté, le mode d'emploi et les précautions d'un ingrédient skincare (ex. niacinamide, rétinol, acide salicylique).",
    parameters: {
      type: Type.OBJECT,
      properties: { ingredient: { type: Type.STRING, description: "Nom de l'ingrédient, en français ou en anglais" } },
      required: ["ingredient"],
    },
  },
  {
    name: "check_ingredient_compatibility",
    description: "Vérifie si plusieurs ingrédients actifs peuvent être utilisés dans la même routine, et comment les répartir sinon.",
    parameters: {
      type: Type.OBJECT,
      properties: { ingredients: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Liste d'au moins 2 ingrédients" } },
      required: ["ingredients"],
    },
  },
  {
    name: "build_skincare_routine",
    description: "Construit une routine visage matin et soir personnalisée. À appeler quand le type de peau et au moins une préoccupation sont connus.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        skin_type: { type: Type.STRING, enum: SKIN_TYPES, description: "Type de peau" },
        concerns: { type: Type.ARRAY, items: { type: Type.STRING, enum: CONCERNS }, description: "Préoccupations principales" },
        pregnant: { type: Type.BOOLEAN, description: "Grossesse ou allaitement" },
        wears_makeup: { type: Type.BOOLEAN, description: "Porte du maquillage au quotidien" },
      },
      required: ["skin_type", "concerns"],
    },
  },
  {
    name: "check_warning_signs",
    description: "Vérifie si les symptômes décrits justifient de consulter un dermatologue ou les urgences. À appeler dès que l'utilisateur décrit une lésion, une douleur, une infection, un grain de beauté ou une réaction.",
    parameters: {
      type: Type.OBJECT,
      properties: { symptoms: { type: Type.STRING, description: "Description des symptômes en français" } },
      required: ["symptoms"],
    },
  },
];

export const toolImplementations = {
  get_ingredient_info: getIngredientInfo,
  check_ingredient_compatibility: checkIngredientCompatibility,
  build_skincare_routine: buildSkincareRoutine,
  check_warning_signs: checkWarningSigns,
};
