#!/usr/bin/env node
/** Синхронізує коди операцій Bazis з .project у constructive_parts (після міграції 0026). */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { resyncBazisOperationCodesForAllPackages } = await import(
  "../src/constructive/bazis-operation-sync.js"
);

const result = await resyncBazisOperationCodesForAllPackages();
console.log(
  `Синхронізовано пакетів: ${result.packages}, оновлено деталей: ${result.partsUpdated}`
);
