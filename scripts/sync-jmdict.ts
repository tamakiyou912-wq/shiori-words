import type { JMdict } from "@scriptin/jmdict-simplified-types";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { x as extractTar } from "tar";

const gzipAsync = promisify(gzip);
const release = process.env.JMDICT_RELEASE || "3.6.2+20260824122934";
const encodedRelease = encodeURIComponent(release);
const archiveName = `jmdict-eng-common-${release}.json.tgz`;
const downloadUrl = process.env.JMDICT_URL
  || `https://github.com/scriptin/jmdict-simplified/releases/download/${encodedRelease}/${archiveName}`;

type CompactEntry = {
  i: string;
  k: string[];
  kc: string[];
  r: string[];
  rc: string[];
  p: string[];
  g: string[];
  c: boolean;
};

async function main() {
  const temporary = await mkdtemp(join(tmpdir(), "shiori-jmdict-"));
  try {
    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`JMdict download failed: HTTP ${response.status}`);
    const archivePath = join(temporary, archiveName);
    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    await extractTar({ file: archivePath, cwd: temporary });
    const jsonName = (await readdir(temporary)).find((name) => name.endsWith(".json"));
    if (!jsonName) throw new Error("JMdict archive did not contain a JSON file");
    const source = JSON.parse(await readFile(join(temporary, jsonName), "utf8")) as JMdict;
    const entries: CompactEntry[] = source.words.flatMap((word) => {
      const readings = [...new Set(word.kana.map((item) => item.text.normalize("NFKC")))];
      const glosses = [...new Set(word.sense.flatMap((sense) => sense.gloss.filter((item) => item.lang === "eng").map((item) => item.text)))].slice(0, 10);
      if (readings.length === 0 || glosses.length === 0) return [];
      return [{
        i: word.id,
        k: [...new Set(word.kanji.map((item) => item.text.normalize("NFKC")))],
        kc: [...new Set(word.kanji.filter((item) => item.common).map((item) => item.text.normalize("NFKC")))],
        r: readings,
        rc: [...new Set(word.kana.filter((item) => item.common).map((item) => item.text.normalize("NFKC")))],
        p: [...new Set(word.sense.flatMap((sense) => sense.partOfSpeech))].slice(0, 8),
        g: glosses,
        c: word.kanji.some((item) => item.common) || word.kana.some((item) => item.common),
      }];
    });
    const compact = JSON.stringify({
      version: source.version,
      dictDate: source.dictDate,
      source: "JMdict / Electronic Dictionary Research and Development Group",
      license: "CC BY-SA 4.0",
      entries,
    });
    const outputDirectory = resolve("public/dictionary");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "jmdict-common.json.gz"), await gzipAsync(compact, { level: 9 }));
    await writeFile(join(outputDirectory, "JMDICT_ATTRIBUTION.txt"), [
      "JMdict Japanese-Multilingual Dictionary",
      "Copyright the Electronic Dictionary Research and Development Group.",
      "Source: https://www.edrdg.org/jmdict/j_jmdict.html",
      "JSON conversion: https://github.com/scriptin/jmdict-simplified",
      "License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)",
      `Dictionary date: ${source.dictDate}; conversion format version: ${source.version}`,
      "This compact derivative contains common entries, spellings, readings, parts of speech, and English glosses.",
      "",
    ].join("\n"));
    console.info(`JMdict compact index: ${entries.length} entries, ${Buffer.byteLength(compact)} bytes before gzip.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
