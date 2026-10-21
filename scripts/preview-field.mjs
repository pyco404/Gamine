// Capture the running village after both the world and loading cover are ready.
// node scripts/preview-field.mjs /tmp/field.png [width] [height]
import { chromium } from "playwright";

const [output = "/tmp/gamine-field.png", width = "1440", height = "1050"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("canvas") && !document.body.innerText.includes("Entering the arena"), undefined, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: output });
  await page.getByRole("button", { name: "Zoom in", exact: true }).last().click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).last().click();
  await page.getByRole("button", { name: "Show the page", exact: true }).click();
  await page.getByRole("heading", { name: "Field", exact: true }).waitFor();
  console.log(JSON.stringify({ output, title: await page.title(), errors, controls: "zoom and field panel passed", overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), world: await page.evaluate(() => window.__village ?? null) }));
} finally {
  await browser.close();
}
