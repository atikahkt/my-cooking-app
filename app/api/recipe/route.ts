import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0] || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }

      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];

      const embedMatch = parsed.pathname.match(/^\/embed\/([^/?]+)/);
      if (embedMatch) return embedMatch[1];
    }
  } catch {
    return null;
  }

  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function getMetaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return null;
}

function getPageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null;
}

function resolveThumbnail(thumbnail: string | null, pageUrl: string): string {
  if (!thumbnail) return "";

  try {
    return new URL(thumbnail, pageUrl).href;
  } catch {
    return thumbnail;
  }
}

type YouTubeOEmbedResponse = {
  title?: string;
  thumbnail_url?: string;
};

function extractJsonObjectAfterMarker(
  html: string,
  marker: string
): Record<string, unknown> | null {
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const jsonStart = start + marker.length;
  if (html[jsonStart] !== "{") return null;

  let depth = 0;
  let jsonEnd = jsonStart;

  for (let i = jsonStart; i < html.length; i++) {
    const char = html[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  if (depth !== 0) return null;

  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractYouTubeDescription(html: string): string | null {
  const playerData = extractJsonObjectAfterMarker(
    html,
    "ytInitialPlayerResponse = "
  );

  const videoDetails = playerData?.videoDetails as
    | { shortDescription?: string }
    | undefined;

  const description = videoDetails?.shortDescription?.trim();
  if (description) return description;

  return (
    getMetaContent(html, "description") ||
    getMetaContent(html, "og:description") ||
    null
  );
}

async function extractYouTubeMetadata(url: string, videoId: string) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (apiKey) {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
    const apiResponse = await fetch(apiUrl);

    if (apiResponse.ok) {
      const apiData = await apiResponse.json();
      const snippet = apiData?.items?.[0]?.snippet;

      if (snippet) {
        return {
          title: snippet.title || "YouTube Video",
          description: snippet.description || "",
          thumbnail:
            snippet.thumbnails?.maxres?.url ||
            snippet.thumbnails?.high?.url ||
            `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        };
      }
    }
  }

  // Fallback to oEmbed if no API key or API fails
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const oembedResponse = await fetch(oembedUrl);
  const oembed: YouTubeOEmbedResponse | null = oembedResponse.ok
    ? await oembedResponse.json()
    : null;

  return {
    title: oembed?.title || "YouTube Video",
    description: "",
    thumbnail:
      oembed?.thumbnail_url ||
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  };
}

async function extractRecipeMetadata(url: string) {
  const youtubeId = extractYouTubeVideoId(url);

  if (youtubeId) {
    return extractYouTubeMetadata(url, youtubeId);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RecipeSaver/1.0; +https://example.com)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status})`);
  }

  const html = await response.text();

  const description =
    getMetaContent(html, "og:description") ||
    getMetaContent(html, "description") ||
    getMetaContent(html, "twitter:description") ||
    "";

  const ogTitle = getMetaContent(html, "og:title") ||
    getMetaContent(html, "twitter:title") ||
    getPageTitle(html) || "";

  const firstDescriptionLine = description.split("\n").find(l => l.trim().length > 0)?.trim() || "";

  const titleLooksGeneric = 
  ogTitle.length < 5 || 
  ogTitle.includes("@") || 
  ogTitle === firstDescriptionLine ||
  /on instagram|on tiktok|on facebook/i.test(ogTitle);

  const title = titleLooksGeneric && firstDescriptionLine
    ? firstDescriptionLine
    : ogTitle || firstDescriptionLine || url;

  const thumbnail = resolveThumbnail(
    getMetaContent(html, "og:image") ||
      getMetaContent(html, "twitter:image") ||
      getMetaContent(html, "twitter:image:src"),
    url
  );

  return { title, description, thumbnail };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: "Invalid URL protocol" }, { status: 400 });
    }

    const metadata = await extractRecipeMetadata(parsedUrl.href);

    const { data, error } = await supabase
      .from("recipes")
      .insert({
        title: metadata.title,
        description: metadata.description,
        thumbnail: metadata.thumbnail,
        source_url: parsedUrl.href,
      })
      .select("id, title, description, thumbnail, source_url, created_at")
      .single();

      if (error) {
        console.error("Failed to save recipe to Supabase:", error);
        if (error.code === "23505") {
          return NextResponse.json(
            { error: "Recipe already saved", duplicate: true },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: "Failed to save recipe" },
          { status: 500 }
        );
      }

    return NextResponse.json({ recipe: data });
  } catch (error) {
    console.error("Recipe API error:", error);
    return NextResponse.json(
      { error: "Failed to process recipe URL" },
      { status: 500 }
    );
  }
}
