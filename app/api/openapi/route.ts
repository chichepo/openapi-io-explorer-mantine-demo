import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DATA_ROOT = path.resolve(process.cwd(), "data");

function isHttpUrl(source: string) {
  return /^https?:\/\//i.test(source);
}

function normalizeSource(source: string) {
  if (source.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(source).pathname);
    } catch {
      return source;
    }
  }
  return source;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source");

  if (!sourceParam) {
    return NextResponse.json({ error: "Missing source parameter." }, { status: 400 });
  }

  const source = normalizeSource(sourceParam.trim());
  if (!source) {
    return NextResponse.json({ error: "Source is empty." }, { status: 400 });
  }

  try {
    if (isHttpUrl(source)) {
      const response = await fetch(source, { cache: "no-store" });
      if (!response.ok) {
        return NextResponse.json(
          { error: `Request failed with ${response.status}.` },
          { status: 400 }
        );
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return NextResponse.json({ error: "Response was not valid JSON." }, { status: 400 });
      }

      return NextResponse.json(data);
    }

    const resolvedPath = path.resolve(source);
    const dataRootPrefix = DATA_ROOT.endsWith(path.sep) ? DATA_ROOT : `${DATA_ROOT}${path.sep}`;
    if (!resolvedPath.startsWith(dataRootPrefix)) {
      return NextResponse.json(
        { error: `Local paths must be inside ${DATA_ROOT}.` },
        { status: 400 }
      );
    }

    const fileContents = await fs.readFile(resolvedPath, "utf8");
    const data = JSON.parse(fileContents);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load source.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
