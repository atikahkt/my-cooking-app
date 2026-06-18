"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Ingredient = { id: string | number; name: string; english_name?: string | null; expiry_date?: string | null };
type Recipe = { id: string; title: string; description: string; thumbnail: string; source_url: string; created_at: string };
type RecipeMatch = { recipe: Recipe; matched: number; total: number; percent: number };
type Translation = { indonesian: string; english: string };

const UNIT_PATTERN = /\b(?:gram|grams|gr|g|kg|ml|l|liter|litre|sdm|sdt|lembar|siung|butir|buah|tbsp|tsp|cup|cups|oz|lb|mg|ons|potong|ikat|bungkus|secukupnya)\b/i;
const INGREDIENTS_SECTION_PATTERN = /^(?:bahan(?:\s*[-–—]\s*bahan)?|ingredients?)\s*:?\s*$/i;
const OTHER_SECTION_PATTERN = /^(?:cara(?:\s*membuat|\s*masak)?|langkah(?:\s*[-–—]\s*langkah)?|prosedur|steps?|instructions?|method|directions?|notes?|tips?|garnish|penyajian|salad|pelengkap|saus|sauce|topping|serving)\s*:?\s*$/i;
const [saveError, setSaveError] = useState<string | null>(null);

const INGREDIENT_EMOJIS: Record<string, string> = {
  "telur": "🥚", "egg": "🥚", "ayam": "🍗", "chicken": "🍗",
  "daging": "🥩", "beef": "🥩", "bawang putih": "🧄", "garlic": "🧄",
  "bawang bombay": "🧅", "onion": "🧅", "tomat": "🍅", "tomato": "🍅",
  "wortel": "🥕", "carrot": "🥕", "kentang": "🥔", "potato": "🥔",
  "timun": "🥒", "cucumber": "🥒", "paprika": "🫑", "cabai": "🌶️",
  "susu": "🥛", "milk": "🥛", "keju": "🧀", "cheese": "🧀",
  "mentega": "🧈", "butter": "🧈", "lemon": "🍋", "jeruk": "🍊",
  "minyak": "🫙", "oil": "🫙", "tepung": "🌾", "flour": "🌾",
  "gula": "🍬", "sugar": "🍬", "garam": "🧂", "salt": "🧂",
};

const AVATAR_COLORS = [
  "bg-orange-100 text-orange-700", "bg-green-100 text-green-700",
  "bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700",
  "bg-pink-100 text-pink-700", "bg-yellow-100 text-yellow-700",
  "bg-teal-100 text-teal-700", "bg-red-100 text-red-800",
];

function getIngredientEmoji(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(INGREDIENT_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return null;
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function getExpiryStatus(expiryDate: string | null | undefined): "expired" | "soon" | "ok" | null {
  if (!expiryDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 3) return "soon";
  return "ok";
}

function getExpiryLabel(expiryDate: string | null | undefined): string | null {
  if (!expiryDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Expired";
  if (diffDays === 0) return "Expires today";
  if (diffDays === 1) return "Expires tomorrow";
  if (diffDays <= 3) return `Expires in ${diffDays} days`;
  return null;
}

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
function parseIngredients(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const ingredients: string[] = [];
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

  if (fridgeLower.some(f => recipeLower === f)) return true;

  if (fridgeLower.some(f => {
    const regex = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
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

const NAV_ITEMS = [
  { label: "Home", icon: "🏠" },
  { label: "Grocery List", icon: "🛒" },
  { label: "Saved", icon: "🔖" },
];

function IngredientModal({ onAdd, onClose, adding }: {
  onAdd: (name: string, englishName: string | null, expiryDate: string | null) => void;
  onClose: () => void;
  adding: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ indonesian: string; english: string }[]>([]);
  const [selected, setSelected] = useState<{ name: string; english_name: string | null } | null>(null);
  const [expiryDate, setExpiryDate] = useState("");

  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); return; }
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from("ingredient_translations")
        .select("indonesian, english")
        .or(`indonesian.ilike.%${query}%,english.ilike.%${query}%`)
        .limit(8);
      setSuggestions(data ?? []);
    }, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  function handleSelect(s: { indonesian: string; english: string }) {
    setSelected({ name: s.indonesian, english_name: s.english });
    setQuery(`${s.indonesian} / ${s.english}`);
    setSuggestions([]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = selected ? selected.name : query.trim();
    const englishName = selected ? selected.english_name : null;
    if (!name) return;
    onAdd(name, englishName, expiryDate || null);
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Add ingredient</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="relative">
            <input type="text" value={query}
              onChange={e => { setQuery(e.target.value); setSelected(null); }}
              placeholder="e.g. cabai, chicken, bawang..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-green-300"
              autoFocus />
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-10 overflow-hidden">
                {suggestions.map((s, i) => (
                  <button key={i} type="button" onClick={() => handleSelect(s)}
                    className="w-full text-left px-3 py-2.5 hover:bg-green-50 transition-colors border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-900">{s.indonesian}</span>
                    <span className="text-xs text-gray-400 ml-2">/ {s.english}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selected && (
            <p className="text-xs text-green-600">✓ {selected.name} / {selected.english_name}</p>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Expiry date (optional)</label>
            <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-green-300" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={adding || !query.trim()}
              className="flex-1 bg-green-600 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
              {adding ? "Adding..." : "Add"}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Home() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [recipeUrl, setRecipeUrl] = useState("");
  const [loadingIngredients, setLoadingIngredients] = useState(true);
  const [loadingRecipes, setLoadingRecipes] = useState(true);
  const [adding, setAdding] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [matchResults, setMatchResults] = useState<RecipeMatch[] | null>(null);
  const [activeNav, setActiveNav] = useState("Home");
  const [showAddIngredient, setShowAddIngredient] = useState(false);
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [surpriseRecipe, setSurpriseRecipe] = useState<Recipe | null>(null);
  const [groceryCount, setGroceryCount] = useState(0);

  async function fetchIngredients() {
    const { data, error } = await supabase.from("ingredients").select("id, name, english_name, expiry_date").order("name");
    if (!error) setIngredients(data ?? []);
    setLoadingIngredients(false);
  }
  async function fetchRecipes() {
    const { data, error } = await supabase.from("recipes").select("id, title, description, thumbnail, source_url, created_at").order("created_at", { ascending: false });
    if (!error) setRecipes(data ?? []);
    setLoadingRecipes(false);
  }
  async function fetchTranslations() {
    const { data } = await supabase.from("ingredient_translations").select("indonesian, english");
    setTranslations(data ?? []);
  }

  useEffect(() => {
    fetchIngredients();
    fetchRecipes();
    fetchTranslations();
    supabase.from("grocery_list").select("id", { count: "exact" }).eq("checked", false)
      .then(({ count }) => setGroceryCount(count ?? 0));
  }, []);

  useEffect(() => {
    if (ingredients.length > 0 && recipes.length > 0 && translations.length > 0) {
      const fridgeNames = ingredients.flatMap(i =>
        i.english_name ? [i.name, i.english_name] : [i.name]
      );
      const results: RecipeMatch[] = recipes.map(recipe => {
        const parsed = parseIngredients(recipe.description);
        if (parsed.length === 0) return null;
        const matched = parsed.filter(ing => fuzzyMatchIngredient(fridgeNames, ing, translations)).length;
        const percent = Math.round((matched / parsed.length) * 100);
        if (percent === 0) return null;
        return { recipe, matched, total: parsed.length, percent };
      }).filter(Boolean).sort((a, b) => b!.percent - a!.percent) as RecipeMatch[];
      setMatchResults(results);
    }
  }, [ingredients, recipes, translations]);

  async function handleDelete(id: Ingredient["id"]) {
    const { data } = await supabase.from("ingredients").delete().eq("id", id).select("id");
    if (data?.length) setIngredients(prev => prev.filter(i => i.id !== id));
  }

  async function handleSaveRecipe(e: React.FormEvent) {
    e.preventDefault();
    const url = recipeUrl.trim();
    if (!url || savingRecipe) return;
    setSavingRecipe(true);
    setSaveError(null);
    const response = await fetch("/api/recipe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const result = await response.json();
    setSavingRecipe(false);
    if (response.ok && result.recipe) {
      setRecipes(prev => [result.recipe, ...prev]);
      setRecipeUrl("");
      setShowAddRecipe(false);
    } else {
      setSaveError(result.duplicate ? "This recipe is already saved." : "Failed to save recipe.");
    }
  }

  function handleSurpriseMe() {
    if (recipes.length === 0) return;
    setSurpriseRecipe(recipes[Math.floor(Math.random() * recipes.length)]);
  }

  function getMatchBadge(percent: number) {
    if (percent >= 70) return "bg-green-100 text-green-700 border border-green-200";
    if (percent >= 40) return "bg-amber-100 text-amber-700 border border-amber-200";
    return "bg-red-100 text-red-600 border border-red-200";
  }

  function getIngredientPillStyle(ingredient: Ingredient) {
    const status = getExpiryStatus(ingredient.expiry_date);
    if (status === "expired") return "bg-red-50 border-red-200";
    if (status === "soon") return "bg-amber-50 border-amber-200";
    return "bg-white border-gray-100";
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-gray-100 px-4 py-6 fixed h-full z-10">
        <div className="mb-8 px-2">
          <span className="text-xl font-bold text-gray-900">FridgeChef</span>
          <p className="text-xs text-gray-400 mt-0.5">Cook smart. Waste less.</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map(item => (
            item.label === "Saved" ? (
              <Link key={item.label} href="/saved"
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
                <span>{item.icon}</span><span>{item.label}</span>
              </Link>
            ) : item.label === "Grocery List" ? (
              <Link key={item.label} href="/grocery"
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
                <span>{item.icon}</span><span>{item.label}</span>
                {groceryCount > 0 && (
                  <span className="ml-auto bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{groceryCount}</span>
                )}
              </Link>
            ) : (
              <button key={item.label} onClick={() => setActiveNav(item.label)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${activeNav === item.label ? "bg-green-50 text-green-700" : "text-gray-600 hover:bg-gray-50"}`}>
                <span>{item.icon}</span><span>{item.label}</span>
              </button>
            )
          ))}
        </nav>
        <div className="px-3 py-2 text-xs text-gray-400">Hello, Chef! 👋</div>
      </aside>

      <main className="flex-1 md:ml-56 px-4 md:px-8 py-8 max-w-4xl">
        {/* Hero */}
        <div className="rounded-2xl bg-gradient-to-br from-green-50 to-emerald-100 border border-green-100 p-6 mb-8 relative overflow-hidden">
          <div className="relative z-10">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">What's in your fridge today?</h1>
            <p className="text-sm text-gray-500 mb-4">Pick what you have and we'll find recipes you can make right now.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowAddIngredient(true)}
                className="flex items-center gap-1.5 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-green-700 transition-colors">
                + Add Ingredient
              </button>
              <button onClick={() => setShowAddRecipe(true)}
                className="flex items-center gap-1.5 bg-white text-gray-700 text-sm font-medium px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
                🔗 Save Recipe
              </button>
              {recipes.length > 0 && (
                <button onClick={handleSurpriseMe}
                  className="flex items-center gap-1.5 bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-amber-500 transition-colors">
                  ✨ Surprise Me
                </button>
              )}
            </div>
          </div>
          <div className="absolute right-4 top-4 text-5xl opacity-20">🧑‍🍳</div>
        </div>

        {/* Add ingredient modal */}
        {showAddIngredient && (
          <IngredientModal
            onAdd={async (name, englishName, expiryDate) => {
              setAdding(true);
              const { data, error } = await supabase.from("ingredients")
                .insert({ name, english_name: englishName || null, expiry_date: expiryDate || null })
                .select("id, name, english_name, expiry_date").single();
              setAdding(false);
              if (!error && data) {
                setIngredients(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
                setShowAddIngredient(false);
              }
            }}
            onClose={() => setShowAddIngredient(false)}
            adding={adding}
          />
        )}

        {/* Surprise Me modal */}
        {surpriseRecipe && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
              {surpriseRecipe.thumbnail ? (
                <img src={surpriseRecipe.thumbnail} alt={surpriseRecipe.title} className="w-full h-48 object-cover" />
              ) : (
                <div className="w-full h-48 bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center text-5xl">🍽️</div>
              )}
              <div className="p-5">
                <p className="text-xs text-amber-500 font-medium mb-1">✨ Today's surprise pick</p>
                <h2 className="text-base font-bold text-gray-900 mb-3 line-clamp-2">{surpriseRecipe.title}</h2>
                <div className="flex gap-2">
                  <Link href={`/recipes/${surpriseRecipe.id}`} onClick={() => setSurpriseRecipe(null)}
                    className="flex-1 bg-green-600 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-green-700 transition-colors text-center">
                    Let's Cook!
                  </Link>
                  <button onClick={handleSurpriseMe}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                    Try Another
                  </button>
                </div>
                <button onClick={() => setSurpriseRecipe(null)} className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Add recipe modal */}
        {showAddRecipe && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Save a recipe</h2>
              <form onSubmit={handleSaveRecipe} className="flex flex-col gap-3">
                <input type="url" value={recipeUrl} onChange={e => setRecipeUrl(e.target.value)}
                  placeholder="Paste YouTube or Instagram URL..."
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-green-300" autoFocus />
                  {saveError && <p className="text-xs text-red-500">{saveError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={savingRecipe || !recipeUrl.trim()}
                    className="flex-1 bg-green-600 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
                    {savingRecipe ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setShowAddRecipe(false)}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Ingredients */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">🥬 Your Ingredients</h2>
            <span className="text-xs text-gray-400">{ingredients.length} items</span>
          </div>
          {loadingIngredients ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : ingredients.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 py-8 text-center">
              <p className="text-sm text-gray-400">No ingredients yet.</p>
              <button onClick={() => setShowAddIngredient(true)} className="mt-2 text-sm text-green-600 font-medium hover:underline">Add your first ingredient →</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ingredients.map(ingredient => {
                const emoji = getIngredientEmoji(ingredient.name);
                const colorClass = getAvatarColor(ingredient.name);
                const expiryStatus = getExpiryStatus(ingredient.expiry_date);
                const expiryLabel = getExpiryLabel(ingredient.expiry_date);
                const pillStyle = getIngredientPillStyle(ingredient);
                return (
                  <div key={ingredient.id} className={`flex items-center gap-2 border rounded-xl px-3 py-2 shadow-sm ${pillStyle}`}>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${emoji ? "bg-orange-50" : colorClass}`}>
                      {emoji ?? ingredient.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm text-gray-800 capitalize leading-tight">
                        {ingredient.name}
                        {ingredient.english_name && (
                          <span className="text-xs text-gray-400 ml-1">/ {ingredient.english_name}</span>
                        )}
                      </span>
                      {expiryLabel && (
                        <span className={`text-xs leading-tight ${expiryStatus === "expired" ? "text-red-500" : "text-amber-500"}`}>
                          {expiryLabel}
                        </span>
                      )}
                    </div>
                    {/* Always visible on mobile, hover-only on desktop */}
                    <button onClick={() => handleDelete(ingredient.id)}
                      className="ml-1 text-gray-300 hover:text-red-400 active:text-red-500 transition-colors text-xs flex-shrink-0 md:opacity-0 md:group-hover:opacity-100 p-1">
                      ✕
                    </button>
                  </div>
                );
              })}
              <button onClick={() => setShowAddIngredient(true)}
                className="flex items-center gap-2 bg-white border-2 border-dashed border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-400 hover:border-green-300 hover:text-green-500 transition-colors">
                + Add More
              </button>
            </div>
          )}
        </section>

        {/* Recipe matches */}
        {matchResults && matchResults.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">✨ Recipes you can make</h2>
              <span className="text-xs text-gray-400">{matchResults.length} matches</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {matchResults.map(({ recipe, matched, total, percent }) => (
                <Link key={recipe.id} href={`/recipes/${recipe.id}`}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden block">
                  <div className="relative">
                    {recipe.thumbnail ? (
                      <img src={recipe.thumbnail} alt={recipe.title} className="h-36 w-full object-cover" />
                    ) : (
                      <div className="h-36 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-3xl">🍽️</div>
                    )}
                    <span className={`absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full ${getMatchBadge(percent)}`}>
                      {percent}% match
                    </span>
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-1">{recipe.title}</h3>
                    <p className="text-xs text-gray-400">{matched}/{total} ingredients</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}