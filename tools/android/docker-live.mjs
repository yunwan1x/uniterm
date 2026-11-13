import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const baseURL = process.env.UNITERM_TEST_URL || "http://127.0.0.1:18091";
const redroid = process.env.REDROID_CONTAINER || "uniterm-redroid-test";
const deviceHost = process.env.ANDROID_HOST || "172.17.0.2";
const devicePort = Number(process.env.ANDROID_PORT || 5555);
assert(
  process.env.UNITERM_TEST_CREDENTIALS,
  "Set UNITERM_TEST_CREDENTIALS to a private JSON file containing username/password",
);
const b = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: "/tmp/uniterm-android-verified-video",
    size: { width: 1440, height: 1000 },
  },
});
const errors = [];
try {
  const cred = JSON.parse(
    fs.readFileSync(process.env.UNITERM_TEST_CREDENTIALS),
  );
  assert.equal(
    (
      await ctx.request.post(`${baseURL}/api/auth/login`, { data: cred })
    ).status(),
    200,
  );
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(baseURL);
  await p.waitForTimeout(1500);
  if (await p.getByRole("button", { name: "Cancel", exact: true }).count())
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
  await p.evaluate(
    ({ deviceHost, devicePort }) =>
      window.dispatchEvent(
        new CustomEvent("app:connect-terminal", {
          detail: {
            id: "redroid-verified",
            name: "Android · redroid · Docker",
            type: "android",
            host: deviceHost,
            port: devicePort,
            user: "",
            password: "",
          },
        }),
      ),
    { deviceHost, devicePort },
  );
  const tab = p.locator(".android-tab");
  const connected = () =>
    p.waitForFunction(
      () =>
        document
          .querySelector(".android-tab footer")
          ?.textContent?.includes("● Android"),
      {},
      { timeout: 20000 },
    );
  await connected();
  await tab.getByRole("button", { name: "Home", exact: true }).click();
  await p.waitForTimeout(600);
  let box = await tab.locator("canvas").boundingBox();
  await p.mouse.click(box.x + box.width * 0.39, box.y + box.height * 0.65);
  await p.waitForTimeout(600);
  assert.match(
    execFileSync("docker", [
      "exec",
      redroid,
      "dumpsys",
      "activity",
      "activities",
    ]).toString(),
    /mResumedActivity:.*gallery/i,
  );
  console.log("PASS final Docker touch opens Gallery");
  await tab.getByRole("button", { name: "Home", exact: true }).click();
  await p.waitForTimeout(400);
  await tab.getByRole("button", { name: "Recent", exact: true }).click();
  await p.waitForTimeout(500);
  await tab.getByRole("button", { name: "Back", exact: true }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: "/tmp/uniterm-android-verified-screen.png" });
  await p.locator(".tab-add-btn").first().click();
  await p.waitForTimeout(300);
  await p
    .locator(".tab-item")
    .filter({ hasText: "Android · redroid · Docker" })
    .first()
    .click();
  await connected();
  console.log("PASS tab switch keeps the existing Android session");
  await tab.getByRole("button", { name: "Files", exact: true }).click();
  const data = Buffer.alloc(1048597);
  for (let i = 0; i < data.length; i++) data[i] = (i * 29) % 256;
  await tab.locator("input[type=file]").setInputFiles({
    name: "verified-你好.bin",
    mimeType: "application/octet-stream",
    buffer: data,
  });
  await p.waitForFunction(
    () =>
      document.querySelector(".android-panel [role=status]")?.textContent ===
      "Completed",
  );
  await tab
    .locator(".android-panel input:not([type=file])")
    .fill("/sdcard/Download/verified-你好.bin");
  const promise = p.waitForEvent("download");
  await tab.getByRole("button", { name: "Download file", exact: true }).click();
  const d = await promise;
  await d.saveAs("/tmp/uniterm-android-verified-download.bin");
  assert.deepEqual(
    fs.readFileSync("/tmp/uniterm-android-verified-download.bin"),
    data,
  );
  console.log(
    "PASS final Docker file round trip SHA256",
    crypto.createHash("sha256").update(data).digest("hex"),
  );
  await p.screenshot({ path: "/tmp/uniterm-android-verified-files.png" });
  await tab.locator(".android-panel .close").click();
  execFileSync("docker", ["stop", "--time", "5", redroid]);
  await tab
    .locator(".android-error")
    .filter({ hasText: "closed" })
    .waitFor({ timeout: 15000 });
  console.log("PASS real device disconnection detected");
  execFileSync("docker", ["start", redroid]);
  let boot = false;
  for (let i = 0; i < 45; i++) {
    try {
      if (
        execFileSync(
          "docker",
          ["exec", redroid, "getprop", "sys.boot_completed"],
          { stdio: ["ignore", "pipe", "ignore"] },
        )
          .toString()
          .trim() === "1"
      ) {
        boot = true;
        break;
      }
    } catch {}
    await p.waitForTimeout(1000);
  }
  assert(boot);
  await tab.getByRole("button", { name: "Reconnect", exact: true }).click();
  await connected();
  assert.equal(await tab.locator(".android-error").count(), 0);
  console.log(
    "PASS actual redroid restart + offline transport recovery + reconnect",
  );
  await p.waitForTimeout(1500);
  assert.equal(await tab.locator("canvas").count(), 1);
  console.log("PASS reconnect replaces old canvas");
  await p.waitForTimeout(2000);
  await p.screenshot({ path: "/tmp/uniterm-android-verified-reconnect.png" });
  assert.deepEqual(errors, []);
  console.log("PASS no browser exceptions");
  fs.writeFileSync(
    "/tmp/uniterm-android-verified-video-path",
    await p.video().path(),
  );
} finally {
  await ctx.close();
  await b.close();
}
