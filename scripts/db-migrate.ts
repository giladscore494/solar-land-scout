import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getPostGISPool } from "@/lib/postgis";

async function main() {
  const pool = await getPostGISPool();
  if (!pool) throw new Error("PostGIS database is required");
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    await pool.query(sql);
    console.log(`applied ${file}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
