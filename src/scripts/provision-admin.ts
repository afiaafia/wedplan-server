import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import {
  connectDatabase,
  getDatabase,
  getMongoClient,
} from "../config/database.js";
import { provisionInitialAdmin } from "../services/admin-provisioning.service.js";

const adminEmailSchema = z.string().trim().email();

async function confirmEmail(email: string): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Admin provisioning requires an interactive terminal");
  }

  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const confirmation = await prompt.question(
      `Type "${email}" to confirm first-Admin provisioning: `
    );
    if (confirmation !== email) {
      throw new Error("The confirmation did not match the configured Admin email");
    }
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const emailResult = adminEmailSchema.safeParse(
    process.env.WEDPLAN_INITIAL_ADMIN_EMAIL
  );
  if (!emailResult.success) {
    throw new Error(
      "Set WEDPLAN_INITIAL_ADMIN_EMAIL to the existing account to provision"
    );
  }

  const email = emailResult.data.toLowerCase();
  await confirmEmail(email);
  await connectDatabase();

  try {
    const account = await provisionInitialAdmin(email, getDatabase());
    console.log(`First Admin provisioned for account ${account.id}.`);
  } finally {
    await getMongoClient().close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Admin provisioning failed: ${message}`);
  process.exitCode = 1;
});
