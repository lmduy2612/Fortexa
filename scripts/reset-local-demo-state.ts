import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import Redis from "ioredis";
import { getStellarNetworkPassphrase } from "../src/lib/stellar/network-config";
import { getFortexaStoreDir } from "../src/lib/storage/paths";

export const PRODUCTION_PASSPHRASE = "Public Global Stellar Network ; July 2015";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export const TARGET_FILES = [
  "audit.json",
  "policy.json",
  "wallets.json",
  "policy-history.json",
  "submit-idempotency.json",
];

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return true;
  if (url.includes("host=")) {
    const match = url.match(/host=([^\s;]+)/);
    if (match) {
      const host = match[1].toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    }
    return true;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    if (url.includes("dbname=") && !url.includes("host=")) {
      return true;
    }
    return false;
  }
}

export function isLocalRedisUrl(url: string | undefined): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

export type ResetOptions = {
  allowLocalReset?: boolean;
  yesFlag?: boolean;
  dryRun?: boolean;
  databaseUrl?: string;
  redisUrl?: string;
  networkPassphrase?: string;
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
  storeDir?: string;
};

export type ResetResult = {
  success: boolean;
  refusalReason?: string;
};

export async function runReset(options: ResetOptions = {}): Promise<ResetResult> {
  const log = options.log ?? console.log;
  const errorLog = options.errorLog ?? console.error;
  const storeDir = options.storeDir ?? getFortexaStoreDir();
  const passphrase = options.networkPassphrase ?? getStellarNetworkPassphrase();

  if (options.dryRun) {
    log("=== Fortexa Local Demo State Reset (DRY-RUN) ===");
    log("[Target Files]");
    for (const file of TARGET_FILES) {
      log(` - ${file}`);
    }
    return {
      success: false,
      refusalReason: "Missing env variable or flags. Dry-run mode completed without changes.",
    };
  }

  // Guard 1: Must be explicitly enabled via env
  if (!options.allowLocalReset) {
    const reason = "Refusal: FORTEXA_ALLOW_LOCAL_RESET=true is required to execute local state reset.";
    errorLog(reason);
    return { success: false, refusalReason: reason };
  }

  // Guard 2: Must be confirmed via --yes flag
  if (!options.yesFlag) {
    const reason = "Refusal: Confirmation flag --yes is required to execute local state reset.";
    errorLog(reason);
    return { success: false, refusalReason: reason };
  }

  // Guard 3: Network safety check - refuse on production network passphrase
  if (passphrase === PRODUCTION_PASSPHRASE) {
    const reason = "REFUSAL: Execution BLOCKED: Reset aborted - production network detected.";
    errorLog(reason);
    return { success: false, refusalReason: reason };
  }

  // Guard 4: Non-local database host check
  if (!isLocalDatabaseUrl(options.databaseUrl)) {
    const reason = "REFUSAL: Execution BLOCKED: Refuses to execute against a non-local database host.";
    errorLog(reason);
    return { success: false, refusalReason: reason };
  }

  // Guard 5: Non-local redis host check
  if (!isLocalRedisUrl(options.redisUrl)) {
    const reason = "REFUSAL: Execution BLOCKED: Refuses to execute against a non-local redis host.";
    errorLog(reason);
    return { success: false, refusalReason: reason };
  }

  // Execution: Remove JSON file stores
  for (const file of TARGET_FILES) {
    const filePath = path.join(storeDir, file);
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore if missing
    }
  }

  // Execution: Truncate PostgreSQL tables and re-seed default policy
  if (options.databaseUrl !== undefined) {
    try {
      const pool = new Pool(options.databaseUrl ? { connectionString: options.databaseUrl } : undefined);
      await pool.query("TRUNCATE TABLE fortexa_wallets, fortexa_audit_log, fortexa_policy_state, fortexa_idempotency;");
      await pool.query("INSERT INTO fortexa_policy_state (id, rules) VALUES ($1, $2)", ["default", "[]"]);
      await pool.end();
    } catch (err) {
      log(`Database reset skipped or failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Execution: Clear Redis keys
  if (options.redisUrl !== undefined) {
    try {
      const redis = new Redis(options.redisUrl || undefined);
      const keys = await redis.keys("fortexa:*");
      for (const k of keys) {
        await redis.del(k);
      }
      redis.disconnect();
    } catch (err) {
      log(`Redis reset skipped or failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("Local demo state reset completed successfully.");
  return { success: true };
}

// CLI entrypoint when executed directly
if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1] &&
  (process.argv[1].endsWith("reset-local-demo-state.ts") || process.argv[1].endsWith("reset-local-demo-state.js"))
) {
  const isYes = process.argv.includes("--yes");
  const isDryRun = process.argv.includes("--dry-run");
  const allowReset = process.env.FORTEXA_ALLOW_LOCAL_RESET === "true";
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;

  runReset({
    allowLocalReset: allowReset,
    yesFlag: isYes,
    dryRun: isDryRun || (!isYes && !allowReset),
    databaseUrl,
    redisUrl,
  })
    .then((result) => {
      if (!result.success) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Reset failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}