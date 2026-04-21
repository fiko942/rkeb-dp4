import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { execFileSync } from "child_process";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const releaseName = "almatrace-server";
const releaseDir = path.join(distDir, releaseName);
const zipPath = path.join(distDir, `${releaseName}-59620.zip`);

const requiredPaths = [
  ".next/BUILD_ID",
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  ".env.example",
  "README.md",
  "LICENSE",
  "data/cache.json"
];

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `File wajib tidak ditemukan: ${relativePath}. Jalankan build penuh dan pastikan semua file runtime tersedia.`
    );
  }
}

rmSync(releaseDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(releaseDir, { recursive: true });

const filesToCopy = [
  ".next",
  "data",
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  ".env.example",
  "README.md",
  "LICENSE",
  "DEPLOY_SERVER.md"
];

for (const relativePath of filesToCopy) {
  const sourcePath = path.join(rootDir, relativePath);
  if (!existsSync(sourcePath)) {
    continue;
  }

  const targetPath = path.join(releaseDir, relativePath);
  cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true
  });
}

rmSync(path.join(releaseDir, ".next", "cache"), {
  recursive: true,
  force: true
});
rmSync(path.join(releaseDir, ".next", "types"), {
  recursive: true,
  force: true
});

writeFileSync(
  path.join(releaseDir, "BUILD_INFO.json"),
  JSON.stringify(
    {
      app: "AlmaTrace",
      port: 59620,
      packagedAt: new Date().toISOString(),
      startCommand: "npm run start"
    },
    null,
    2
  )
);

try {
  execFileSync("zip", ["-qry", zipPath, releaseName], {
    cwd: distDir,
    stdio: "inherit"
  });
} catch (error) {
  throw new Error(
    "Gagal membuat file zip. Pastikan perintah 'zip' tersedia di sistem lokal."
  );
}

console.log(`Paket server siap: ${zipPath}`);
