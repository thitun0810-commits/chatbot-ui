// app/api/embed-legal/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const GUARD = process.env.EMBED_ADMIN_TOKEN!; // bạn tự đặt

export async function POST(req: Request) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY || !GUARD) {
      return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
    }
    if (req.headers.get("x-embed-token") !== GUARD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      table = "legal_docs",
      id_column = "id",
      text_column = "chunk",
      embed_column = "embedding",
      limit = 500,
    } = (await req.json().catch(() => ({}))) as any;

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Lấy các hàng chưa có embedding
    const { data: rows, error } = await sb
      .from(table)
      .select(`${id_column}, ${text_column}`)
      .is(embed_column, null)
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows?.length) return NextResponse.json({ updated: 0 });

    // Gọi OpenAI Embeddings batch
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: rows.map((r: any) => r[text_column]),
      }),
    });

    const json = await resp.json();
    if (!resp.ok) return NextResponse.json({ error: json }, { status: 500 });

    // Upsert embedding vào Supabase
    const updates = rows.map((r: any, i: number) => ({
      [id_column]: r[id_column],
      [embed_column]: json.data[i].embedding,
    }));

    const { error: upErr } = await sb.from(table).upsert(updates);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ updated: updates.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
