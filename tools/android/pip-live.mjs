import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const baseURL = process.env.UNITERM_TEST_URL || "http://127.0.0.1:18092";
const credentials = process.env.UNITERM_TEST_CREDENTIALS;
assert(
  credentials,
  "Set UNITERM_TEST_CREDENTIALS to a private JSON credentials file",
);
const redroid = process.env.REDROID_CONTAINER || "uniterm-redroid-test";
const deviceHost = process.env.ANDROID_HOST || "127.0.0.1";
const devicePort = Number(process.env.ANDROID_PORT || 15555);
const b = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--window-size=1440,1000",
  ],
});
const ctx = await b.newContext({
  viewport: null,
  recordVideo: {
    dir: "/tmp/uniterm-pip-video",
    size: { width: 1440, height: 1000 },
  },
});
const errors = [];
ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
await ctx.request.post(`${baseURL}/api/auth/login`, {
  data: JSON.parse(fs.readFileSync(credentials)),
});
const p = await ctx.newPage();
await p.goto(baseURL);
await p.waitForTimeout(1500);
if (await p.getByRole("button", { name: "Cancel", exact: true }).count())
  await p.getByRole("button", { name: "Cancel", exact: true }).click();
await p.evaluate(
  ({ deviceHost, devicePort }) =>
    window.dispatchEvent(
      new CustomEvent("app:connect-terminal", {
        detail: {
          id: "redroid-pip",
          name: "Android PiP test",
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
await p.waitForFunction(
  () =>
    document
      .querySelector(".android-tab footer")
      ?.textContent?.includes("● Android"),
  {},
  { timeout: 25000 },
);

try {
  await p
    .locator(".android-tab canvas")
    .evaluate((c) => (c.dataset.testIdentity = "original-canvas"));
  await p.getByRole("button", { name: "Floating window", exact: true }).click();
  await p.waitForTimeout(500);
  let pip = ctx.pages().find((x) => x !== p);
  assert(pip, "native Document PiP must open");
  await pip.setViewportSize({ width: 360, height: 690 });
  assert.equal(await pip.locator("canvas").count(), 1);
  assert.equal(await p.locator("canvas").count(), 0);
  await pip.getByRole("button", { name: "Home", exact: true }).click();
  await pip.waitForTimeout(800);
  const r = await pip.locator("canvas").boundingBox();
  await pip.mouse.click(r.x + r.width * 0.39, r.y + r.height * 0.65);
  await pip.waitForTimeout(800);
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
  console.log("PASS real Android touch in native PiP");
  await p.locator(".tab-add-btn").first().click();
  await p.waitForTimeout(400);
  assert.equal(await pip.locator("canvas").count(), 1);
  await pip.getByRole("button", { name: "Home", exact: true }).click();
  console.log("PASS native PiP persists across tab switch");
  await pip.screenshot({ path: "/tmp/uniterm-pip-native.png" });
  await pip.close();
  await p.waitForFunction(() =>
    document
      .querySelector(".tab-item.active")
      ?.textContent?.includes("Android PiP test"),
  );
  console.log("PASS native close activates original tab");
  await p
    .locator(".tab-item")
    .filter({ hasText: "Android PiP test" })
    .first()
    .click();
  await p.waitForTimeout(400);
  assert.equal(await p.locator(".android-tab canvas").count(), 1);
  assert.equal(await p.locator(".android-floating").count(), 0);
  console.log("PASS native window close restores existing canvas");
  await p.evaluate(() =>
    Object.defineProperty(window, "documentPictureInPicture", {
      value: undefined,
      configurable: true,
    }),
  );
  await p.getByRole("button", { name: "Floating window", exact: true }).click();
  const f = p.locator(".android-floating-page");
  await f.waitFor();
  await p.waitForTimeout(200);
  const before = await f.boundingBox();
  const drag = await f.locator(".android-drag").boundingBox();
  await p.mouse.move(drag.x + 5, drag.y + 5);
  await p.mouse.down();
  await p.mouse.move(drag.x - 160, drag.y + 80);
  await p.mouse.up();
  const after = await f.boundingBox();
  assert(after.x < before.x - 100);
  console.log("PASS fallback drag");
  const resize = await f.locator(".android-resize").boundingBox();
  await p.mouse.move(resize.x + 7, resize.y + 7);
  await p.mouse.down();
  await p.mouse.move(resize.x + 67, resize.y + 47);
  await p.mouse.up();
  assert((await f.boundingBox()).width > after.width + 40);
  console.log("PASS fallback resize");
  await p.locator(".tab-add-btn").first().click();
  await p.waitForTimeout(300);
  assert(await f.isVisible());
  assert.equal(await f.locator("canvas").count(), 1);
  await f.getByRole("button", { name: "Home", exact: true }).click();
  console.log("PASS fallback remains interactive on other tab");
  await p.screenshot({ path: "/tmp/uniterm-pip-fallback.png" });
  await f
    .getByRole("button", { name: "Close window and restore", exact: true })
    .click();
  await p
    .locator(".tab-item")
    .filter({ hasText: "Android PiP test" })
    .first()
    .click();
  await p.waitForTimeout(200);
  assert.equal(await p.locator(".android-tab canvas").count(), 1);
  assert.equal(await p.locator(".android-floating").count(), 0);
  console.log("PASS fallback close restores");
  await p.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await p.waitForFunction(() => !!document.fullscreenElement);
  await p.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await p.waitForFunction(() => !document.fullscreenElement);
  console.log("PASS fullscreen enter/exit");

  // Browser-policy denial follows the same local fallback, without a broken view.
  await p.evaluate(() =>
    Object.defineProperty(window, "documentPictureInPicture", {
      value: {
        requestWindow: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
      configurable: true,
    }),
  );
  await p.getByRole("button", { name: "Floating window", exact: true }).click();
  await p.locator(".android-floating-page").waitFor();
  console.log("PASS policy denial uses page fallback");
  await p
    .locator(".android-floating-page")
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await p.waitForTimeout(200);
  assert.equal(
    await p.locator("canvas").getAttribute("data-test-identity"),
    "original-canvas",
  );
  console.log("PASS same canvas preserved through all transitions");
  await p.screenshot({ path: "/tmp/uniterm-pip-status.png" });
  await p.getByRole("button", { name: "Floating window", exact: true }).click();
  await p.locator(".android-floating-page").waitFor();
  await p
    .locator(".tab-item")
    .filter({ hasText: "Android PiP test" })
    .first()
    .hover();
  await p
    .locator(".tab-item")
    .filter({ hasText: "Android PiP test" })
    .first()
    .locator(".tab-close")
    .last()
    .click();
  await p
    .locator(".el-message-box")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await p.waitForFunction(() => !document.querySelector(".android-floating"));
  console.log("PASS closing Android connection removes floating window");
  assert.deepEqual(errors, []);
  console.log("PASS no browser exceptions");
  fs.writeFileSync("/tmp/uniterm-pip-video-path", await p.video().path());
} finally {
  await ctx.close();
  await b.close();
}
