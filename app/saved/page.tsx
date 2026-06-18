"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Recipe = {
  id: string; title: string; description: string;
  thumbnail: string; source_url: string; created_at: string;
};

export default function SavedPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipeUrl, setRecipeUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRecipes() {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, title, description, thumbnail, source_url, created_at")
        .order("created_at", { ascending: false });
      if (!error) setRecipes(data ?? []);
      setLoading(false);
    }
    fetchRecipes();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const url = recipeUrl.trim();
    if (!url || saving) return;
    setSaving(true);
    setSaveError(null);
    const response = await fetch("/api/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const result = await response.json();
    setSaving(false);
    if (response.ok && result.recipe) {
      setRecipes(prev => [result.recipe, ...prev]);
      setRecipeUrl("");
      setShowAdd(false);
    } else {
      setSaveError(result.duplicate ? "This recipe is already saved." : "Failed to save recipe.");
    }
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (!error) setRecipes(prev => prev.filter(r => r.id !== id));
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-gray-100 px-4 py-6 fixed h-full z-10">
        <div className="mb-8 px-2">
          <span className="text-xl font-bold text-gray-900">FridgeChef</span>
          <p className="text-xs text-gray-400 mt-0.5">Cook smart. Waste less.</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <span>🏠</span><span>Home</span>
          </Link>
          <Link href="/grocery" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <span>🛒</span><span>Grocery List</span>
          </Link>
          <Link href="/saved" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium bg-green-50 text-green-700">
            <span>🔖</span><span>Saved</span>
          </Link>
        </nav>
        <div className="px-3 py-2 text-xs text-gray-400">Hello, Chef! 👋</div>
      </aside>

      <main className="flex-1 md:ml-56 px-4 md:px-8 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">🔖 Saved Recipes</h1>
            <p className="text-xs text-gray-400 mt-0.5">{recipes.length} recipes saved</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-green-700 transition-colors">
            + Save new
          </button>
        </div>

        {showAdd && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Save a recipe</h2>
              <form onSubmit={handleSave} className="flex flex-col gap-3">
                <input type="url" value={recipeUrl} onChange={e => setRecipeUrl(e.target.value)}
                  placeholder="Paste YouTube or Instagram URL..."
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-green-300" autoFocus />
                {saveError && <p className="text-xs text-red-500">{saveError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={saving || !recipeUrl.trim()}
                    className="flex-1 bg-green-600 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setShowAdd(false)}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-400">Loading recipes...</p>
        ) : recipes.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
            <p className="text-2xl mb-2">🍽️</p>
            <p className="text-sm text-gray-400">No recipes saved yet.</p>
            <button onClick={() => setShowAdd(true)} className="mt-2 text-sm text-green-600 font-medium hover:underline">
              Save your first recipe →
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map(recipe => (
              <article key={recipe.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
                <Link href={`/recipes/${recipe.id}`} className="block">
                  {recipe.thumbnail ? (
                    <img src={recipe.thumbnail} alt={recipe.title} className="h-36 w-full object-cover" />
                  ) : (
                    <div className="h-36 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-3xl">🍽️</div>
                  )}
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-gray-900 line-clamp-2">{recipe.title}</h3>
                  </div>
                </Link>
                <div className="px-3 pb-3 flex items-center justify-between">
                  <a href={recipe.source_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-green-600 transition-colors">
                    View source →
                  </a>
                  <button onClick={() => handleDelete(recipe.id)}
                    className="text-xs text-gray-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}