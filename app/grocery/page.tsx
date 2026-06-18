"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type GroceryItem = {
  id: string;
  ingredient: string;
  recipe_id: string;
  recipe_title: string;
  checked: boolean;
  created_at: string;
};

export default function GroceryPage() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchItems() {
      const { data, error } = await supabase
        .from("grocery_list")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error) setItems(data ?? []);
      setLoading(false);
    }
    fetchItems();
  }, []);

  async function toggleItem(id: string, checked: boolean) {
    await supabase.from("grocery_list").update({ checked }).eq("id", id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked } : i));
  }

  async function deleteItem(id: string) {
    await supabase.from("grocery_list").delete().eq("id", id);
    setItems(prev => prev.filter(i => i.id !== id));
  }

  async function clearAll() {
    await supabase.from("grocery_list").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setItems([]);
  }

  // Group by recipe
  const grouped = items.reduce((acc, item) => {
    const key = item.recipe_title || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, GroceryItem[]>);

  const uncheckedCount = items.filter(i => !i.checked).length;

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-gray-100 px-4 py-6 fixed h-full z-10">
        <div className="mb-8 px-2">
          <span className="text-xl font-bold text-gray-900">FridgeChef</span>
          <p className="text-xs text-gray-400 mt-0.5">Cook smart. Waste less.</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <span>🏠</span><span>Home</span>
          </Link>
          <Link href="/grocery" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium bg-green-50 text-green-700">
            <span>🛒</span><span>Grocery List</span>
            {uncheckedCount > 0 && (
              <span className="ml-auto bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{uncheckedCount}</span>
            )}
          </Link>
          <Link href="/saved" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <span>🔖</span><span>Saved</span>
          </Link>
        </nav>
        <div className="px-3 py-2 text-xs text-gray-400">Hello, Chef! 👋</div>
      </aside>

      <main className="flex-1 md:ml-56 px-4 md:px-8 py-8 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">🛒 Grocery List</h1>
            <p className="text-xs text-gray-400 mt-0.5">{uncheckedCount} items to buy</p>
          </div>
          {items.length > 0 && (
            <button onClick={clearAll} className="text-xs text-red-400 hover:text-red-600 font-medium">Clear all</button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : items.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
            <p className="text-2xl mb-2">🛒</p>
            <p className="text-sm text-gray-400">Your grocery list is empty.</p>
            <p className="text-xs text-gray-300 mt-1">Open a recipe and save the missing ingredients.</p>
            <Link href="/" className="mt-3 inline-block text-sm text-green-600 font-medium hover:underline">Browse recipes →</Link>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([recipeTitle, groupItems]) => (
              <div key={recipeTitle} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700 line-clamp-1">{recipeTitle}</h2>
                  <span className="text-xs text-gray-400">{groupItems.filter(i => !i.checked).length} left</span>
                </div>
                <ul className="divide-y divide-gray-50">
                  {groupItems.map(item => (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <input type="checkbox" checked={item.checked}
                        onChange={e => toggleItem(item.id, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-300 flex-shrink-0" />
                      <span className={`flex-1 text-sm ${item.checked ? "line-through text-gray-400" : "text-gray-800"}`}>
                        {item.ingredient}
                      </span>
                      <button onClick={() => deleteItem(item.id)}
                        className="text-gray-300 hover:text-red-400 text-xs transition-colors">✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}