"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Recipe = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  source_url: string;
  created_at: string;
};

type Translation = { indonesian: string; english: string };

// --- YouTube helper ---
function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch { return null; }
  return null;
}

// --- Ingredient parser ---
const UNIT_PATTERN = /\b(?:gram|grams|gr|g|kg|ml|l|liter|litre|sdm|sdt|lembar|siung|butir|buah|tbsp|tsp|cup|cups|oz|lb|mg|ons|potong|ikat|bungkus|secukupnya|ekor|ruas|batang|sachet|pcs|pieces?)\b/i;
const INGREDIENTS_SECTION_PATTERN = /^(?:bahan(?:\s*[-–—]\s*bahan)?|ingredients?)\s*:?\s*$/i;
const OTHER_SECTION_PATTERN = /^(?:cara(?:\s*membuat|\s*masak)?|langkah(?:\s*[-–—]\s*langkah)?|prosedur|steps?|instructions?|method|directions?|notes?|tips?|garnish|penyajian|salad|pelengkap|saus|sauce|topping|serving)\s*:?\s*$/i;

function normalizeHeader(line: string) {
  return line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/[:：]\s*.*$/, "").trim();
}
function looksLikeSectionHeader(line: string) {
  const h = normalizeHeader(line);
  return INGREDIENTS_SECTION_PATTERN.test(h) || OTHER_SECTION_PATTERN.test(h);
}
function normalizeLine(line: string) {
  return line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/^[-–—•*]\s*/, "").trim();
}

function parseIngredientsFromDescription(description: string): string[] {
  let textToParse = description;
  const idSectionMatch = description.match(/\[INDONESIAN\]([\s\S]*?)(?:={5,}|\[ENGLISH\]|$)/i);
  if (idSectionMatch) {
    textToParse = idSectionMatch[1];
  } else {
    const separatorMatch = description.search(/={5,}|\[ENGLISH\]|\[english\]/i);
    if (separatorMatch > 0) textToParse = description.slice(0, separatorMatch);
  }

  const lines = textToParse.split(/\r?\n/);
  const ingredients: string[] = [];
  const idWords = /\b(sdm|sdt|siung|butir|buah|lembar|iris|potong|secukupnya|bawang|ayam|daging|telur|terigu|maizena|gula|garam|merica|minyak|kecap|santan|tepung|saus|jahe|kunyit|serai|kemiri|lengkuas|cabai|tomat|wortel|kentang|udang|ikan|tempe|tahu)\b/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\d{1,2}[:.]\d{2}/.test(line)) continue;
    if (looksLikeSectionHeader(line)) continue;
    if (/^#/.test(line)) continue;
    if (line.length > 100) continue;
    const strippedLine = line.replace(/^[-–—•*]\s*/, "");
    const startsWithQuantity = /^(?:\d+[.,/]?\d*\s*|[½¼¾⅓⅔⅛⅜⅝⅞]\s*)/.test(strippedLine);
    const isSecukupnya = /secukupnya/i.test(strippedLine);
    if (!startsWithQuantity && !isSecukupnya) continue;
    if (/^\d+\.\s+[A-Za-zÀ-ÿ]/.test(strippedLine)) continue;
    if (!UNIT_PATTERN.test(strippedLine) && strippedLine.length > 50) continue;
    const hasIndonesian = idWords.test(line);
    const hasEnglishOnlyUnits = /\b(tbsp|tsp|cup|cups|oz|lb|clove|stalk|pc|pcs|piece|pieces|head|bunch)\b/i.test(line);
    const hasIndonesianUnits = /\b(sdm|sdt|siung|butir|buah|lembar|ekor|ruas|batang|ikat|bungkus)\b/i.test(line);
    if (hasEnglishOnlyUnits && !hasIndonesian && !hasIndonesianUnits) continue;
    const cleaned = normalizeLine(line);
    if (cleaned) ingredients.push(cleaned);
  }

  const seen = new Set<string>();
  return ingredients.filter(line => {
    const key = line.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fuzzyMatchIngredient(fridgeItems: string[], recipeIngredient: string, translations: Translation[]): boolean {
  const recipeLower = recipeIngredient.toLowerCase();
  const fridgeLower = fridgeItems.map(f => f.toLowerCase());

  if (fridgeLower.some(f => f === recipeLower)) return true;

  if (fridgeLower.some(f => {
    const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s)${escaped}(\\s|$|,)`);
    return regex.test(recipeLower);
  })) return true;

  for (const fridgeItem of fridgeLower) {
    for (const t of translations) {
      const id = t.indonesian.toLowerCase();
      const en = t.english.toLowerCase();
      const variants = [id, en];
      if (!variants.some(v => v === fridgeItem)) continue;
      const recipeMatches = variants.some(v => {
        if (!recipeLower.includes(v)) return false;
        const idx = recipeLower.indexOf(v);
        const before = idx > 0 ? recipeLower[idx - 1] : ' ';
        return before === ' ' || idx === 0;
      });
      if (recipeMatches) return true;
    }
  }
  return false;
}

function splitIngredient(line: string): { quantity: string; name: string } {
  const match = line.match(/^((?:[\d.,/]+\s*(?:[\d.,/]+\s*)?)?(?:gram|grams|gr|g|kg|ml|l|liter|litre|sdm|sdt|lembar|siung|butir|buah|tbsp|tsp|cup|cups|oz|lb|mg|ons|potong|ikat|bungkus|secukupnya|ekor|ruas|batang|sachet|pcs|pieces?)?\s*)/i);
  if (match && match[1].trim()) {
    return { quantity: match[1].trim(), name: line.slice(match[1].length).trim() };
  }
  return { quantity: "", name: line };
}

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedIngredients, setCheckedIngredients] = useState<Record<number, boolean>>({});
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const parsedIngredients = useMemo(
    () => (recipe ? parseIngredientsFromDescription(recipe.description) : []),
    [recipe]
  );

  const groceryList = parsedIngredients.filter((_, i) => !checkedIngredients[i]);

  useEffect(() => {
    async function fetchData() {
      const [recipeResult, fridgeResult, translationsResult] = await Promise.all([
        supabase.from("recipes").select("id, title, description, thumbnail, source_url, created_at").eq("id", params.id).single(),
        supabase.from("ingredients").select("name, english_name"),
        supabase.from("ingredient_translations").select("indonesian, english"),
      ]);

      const fetchedTranslations = translationsResult.data ?? [];
      setTranslations(fetchedTranslations);

      if (recipeResult.error) { setRecipe(null); }
      else {
        setRecipe(recipeResult.data);
        if (recipeResult.data && fridgeResult.data) {
          const fridgeNames = fridgeResult.data.flatMap((i: { name: string; english_name?: string | null }) =>
            i.english_name ? [i.name, i.english_name] : [i.name]
          );
          const parsed = parseIngredientsFromDescription(recipeResult.data.description);
          const autoChecked: Record<number, boolean> = {};
          parsed.forEach((ingredient, index) => {
            if (fuzzyMatchIngredient(fridgeNames, ingredient, fetchedTranslations)) autoChecked[index] = true;
          });
          setCheckedIngredients(autoChecked);
        }
      }
      setLoading(false);
    }
    if (params.id) fetchData();
  }, [params.id]);

  async function handleSaveTitle() {
    if (!recipe) return;
    const { error } = await supabase.from("recipes").update({ title: titleInput }).eq("id", recipe.id);
    if (!error) { setRecipe({ ...recipe, title: titleInput }); setEditingTitle(false); }
  }

  function toggleIngredient(index: number) {
    setCheckedIngredients(prev => ({ ...prev, [index]: !prev[index] }));
  }

  function getSourceLabel(url: string) {
    if (url.includes("youtube.com") || url.includes("youtu.be")) return { label: "YouTube", color: "bg-red-100 text-red-600" };
    if (url.includes("instagram.com")) return { label: "Instagram", color: "bg-pink-100 text-pink-600" };
    if (url.includes("tiktok.com")) return { label: "TikTok", color: "bg-gray-100 text-gray-600" };
    return { label: "Source", color: "bg-blue-100 text-blue-600" };
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading recipe...</p>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-sm text-gray-500 mb-3">Recipe not found.</p>
          <Link href="/" className="text-sm font-medium text-green-600 hover:underline">← Back to home</Link>
        </div>
      </div>
    );
  }

  const youtubeId = extractYouTubeVideoId(recipe.source_url);
  const source = getSourceLabel(recipe.source_url);
  const checkedCount = Object.values(checkedIngredients).filter(Boolean).length;

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-50">
      {/* Left panel */}
      <div className="w-full lg:w-80 bg-white border-b lg:border-b-0 lg:border-r border-gray-100 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-100">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1">← Back</Link>
        </div>

        <div className="relative">
          {youtubeId ? (
            <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
              <iframe src={`https://www.youtube.com/embed/${youtubeId}`}
                className="absolute inset-0 w-full h-full" allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
            </div>
          ) : recipe.thumbnail ? (
            <a href={recipe.source_url} target="_blank" rel="noopener noreferrer">
              <img src={recipe.thumbnail} alt={recipe.title} className="w-full h-48 object-cover" />
            </a>
          ) : (
            <div className="w-full h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-4xl">🍽️</div>
          )}
        </div>

        <div className="p-4 flex-1 flex flex-col gap-3">
          {editingTitle ? (
            <div className="flex flex-col gap-2">
              <input type="text" value={titleInput} onChange={e => setTitleInput(e.target.value)}
                className="text-base font-semibold border-b border-gray-300 outline-none bg-transparent w-full" />
              <div className="flex gap-2">
                <button onClick={handleSaveTitle} className="text-xs text-green-600 font-medium">Save</button>
                <button onClick={() => setEditingTitle(false)} className="text-xs text-gray-400">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="group flex items-start gap-2">
              <h1 className="text-base font-bold text-gray-900 flex-1">{recipe.title}</h1>
              <button onClick={() => { setTitleInput(recipe.title); setEditingTitle(true); }}
                className="text-xs text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 mt-0.5 flex-shrink-0">✏️</button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${source.color}`}>{source.label}</span>
            <a href={recipe.source_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-green-600 transition-colors">View on {source.label} ↗</a>
          </div>

          {recipe.description ? (
            <div className="flex-1 overflow-y-auto">
              <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed line-clamp-6">{recipe.description}</p>
            </div>
          ) : null}

          {parsedIngredients.length > 0 && (
            <div className="mt-auto pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{checkedCount}/{parsedIngredients.length} ingredients</span>
                <span className={checkedCount === parsedIngredients.length ? "text-green-600 font-medium" : "text-amber-500"}>
                  {checkedCount === parsedIngredients.length ? "✓ You have everything!" : `${parsedIngredients.length - checkedCount} missing`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${parsedIngredients.length > 0 ? (checkedCount / parsedIngredients.length) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Middle panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-6 border-b border-gray-100 bg-white flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Ingredients</h2>
          {parsedIngredients.length > 0 && (
            <button onClick={() => {
              const allChecked = parsedIngredients.every((_, i) => checkedIngredients[i]);
              const newState: Record<number, boolean> = {};
              if (!allChecked) parsedIngredients.forEach((_, i) => { newState[i] = true; });
              setCheckedIngredients(newState);
            }} className="text-xs text-green-600 font-medium hover:underline">
              {parsedIngredients.every((_, i) => checkedIngredients[i]) ? "Unselect all" : "Select all"}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {parsedIngredients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <p className="text-sm text-gray-400">No ingredients detected.</p>
              <p className="text-xs text-gray-300 mt-1">This recipe may not have structured ingredients in its description.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {parsedIngredients.map((ingredient, index) => {
                const checked = !!checkedIngredients[index];
                const { quantity, name } = splitIngredient(ingredient);
                return (
                  <label key={index} className={`flex items-center gap-4 px-6 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${checked ? "bg-green-50/30" : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleIngredient(index)}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-300 flex-shrink-0" />
                    <span className="w-20 text-sm text-gray-400 flex-shrink-0">{quantity}</span>
                    <span className={`flex-1 text-sm ${checked ? "text-gray-400 line-through" : "text-gray-800"}`}>{name || ingredient}</span>
                    <span className={`text-xs font-medium flex-shrink-0 ${checked ? "text-green-600" : "text-amber-500"}`}>
                      {checked ? "I have this" : "I need this"}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Grocery List */}
      <div className="flex lg:w-64 flex-col bg-white border-t lg:border-t-0 lg:border-l border-gray-100">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Grocery List</h2>
            {groceryList.length > 0 && (
              <span className="bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{groceryList.length}</span>
            )}
          </div>
          {groceryList.length > 0 && (
            <div className="flex gap-2">
              <button onClick={async () => {
                const items = groceryList.map(ingredient => ({
                  ingredient,
                  recipe_id: recipe.id,
                  recipe_title: recipe.title,
                  checked: false,
                }));
                const { error } = await supabase.from("grocery_list").insert(items);
                if (!error) alert(`✓ ${groceryList.length} items saved!`);
              }} className="text-xs text-green-600 font-medium hover:underline">Save list</button>
              <button onClick={() => setCheckedIngredients(Object.fromEntries(parsedIngredients.map((_, i) => [i, true])))}
                className="text-xs text-gray-400 hover:text-gray-600">Clear all</button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {groceryList.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-8">
              {parsedIngredients.length === 0 ? "No ingredients found." : "✓ You have everything!"}
            </p>
          ) : (
            <ul className="space-y-2">
              {groceryList.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-xs text-gray-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-1.5" />
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}