import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

/**
 * The golden path (BUILD_PLAN Phase 7): open /work, get a wallet, claim,
 * upload a photo, poll to paid, assert the receipt carries a tx hash.
 * Uses the deterministic orange test-card task so it runs before the real
 * fixture photos exist. Real chain + real model — allow minutes.
 */

const PASSCODE = process.env.ADMIN_PASSCODE ?? "legwork-dev";

test("worker goes from link to paid receipt", async ({ page }) => {
  test.setTimeout(240_000);

  // A fresh test-card task via the director (retry over dev-server cold start).
  let taskId: string | undefined;
  for (let attempt = 0; attempt < 5 && !taskId; attempt++) {
    const posted = await page.request.post("/api/director", {
      headers: { "x-admin-passcode": PASSCODE },
      data: { action: "insert_test_task" },
    });
    if (posted.ok()) taskId = (await posted.json()).taskId;
    else await page.waitForTimeout(2000);
  }
  expect(taskId).toBeTruthy();

  // /work creates the wallet and runs sponsored onboarding.
  await page.goto("/work");
  await expect(
    page.getByText("Your wallet is ready. Legwork paid the setup, you’ll never need to."),
  ).toBeVisible({ timeout: 45_000 });

  // Claim.
  await page.goto(`/work/tasks/${taskId}`);
  await page.getByRole("button", { name: "Start task" }).click();

  // Attach the photo (the hidden camera input) and wait for escrow funding.
  await page.setInputFiles('input[type="file"]', {
    name: "orange.png",
    mimeType: "image/png",
    buffer: orangePng(),
  });
  const submit = page.getByRole("button", { name: /Submit photo/ });
  await expect(submit).toBeEnabled({ timeout: 60_000 }); // enabled once funded
  await submit.click();

  // Verify → release → the receipt prints with a transaction hash.
  await expect(page.getByText("Submit → paid")).toBeVisible({ timeout: 120_000 });
  const txLink = page.locator('a[href*="stellar.expert/explorer/testnet/tx/"]').first();
  await expect(txLink).toBeVisible();
  expect(await txLink.getAttribute("href")).toMatch(/\/tx\/[0-9a-f]{64}$/);
});

function orangePng(size = 512): Buffer {
  // Jitter the shade per run — identical bytes would (correctly) trip the
  // duplicate-submission check.
  const jitter = () => Math.floor(Math.random() * 24) - 12;
  const [r, g, b] = [232 + jitter(), 100 + jitter(), 27 + Math.abs(jitter())];
  const crcTable = Array.from({ length: 256 }, (_, k) => {
    let c = k;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3)]);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
