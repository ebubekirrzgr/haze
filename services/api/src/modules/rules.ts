/**
 * Kural motoru — maaş kuralı: USDC G-hesabına düşünce vault.settle_salary(tutar, borç) çağrılır.
 * Allowance (miktar ve süre) yetersizse çağrılmaz, kullanıcıdan yenileme istenir.
 * Kalan USDC teminata eklenir; hUSDY/hXAU dağılımı kullanıcının tek passkey onayıyla (istemci) yapılır.
 */
import { toFloat } from "@haze/stellar";
import type { ChainOps } from "../chain.ts";
import type { Db } from "../db.ts";
import type { CreditService } from "./credit.ts";

export interface RulesDeps {
  db: Db;
  chain: ChainOps;
  credit: CreditService;
  log?: (msg: string) => void;
}

export type SettleOutcome =
  | { ok: true; tx: string; amount: bigint; repaid: bigint; collateralAdded: bigint }
  | { ok: false; reason: "no_vault" | "allowance_amount" | "allowance_expired" | "no_balance" | "error"; detail?: string; needed?: bigint };

export class RulesService {
  constructor(private readonly d: RulesDeps) {}

  /**
   * Maaş geldi: `amount` USDC (7 ondalık) G-hesabında. Allowance'ı kontrol eder, borcu okur, settle eder.
   * `amount` verilmezse hesabın USDC bakiyesinin tamamı kullanılır (allowance ile sınırlı).
   */
  async settleSalary(userId: string, amount?: bigint): Promise<SettleOutcome> {
    const user = this.d.db.user(userId);
    if (!user?.vault_address) return { ok: false, reason: "no_vault" };
    const vault = user.vault_address;

    const [allowance, ledger, balance] = await Promise.all([
      this.d.chain.usdcAllowance(user.g_address, vault),
      this.d.chain.latestLedger(),
      this.d.chain.usdcBalance(user.g_address),
    ]);
    const want = amount ?? balance;
    if (want <= 0n) return { ok: false, reason: "no_balance" };
    if (user.allowance_expiry_ledger && user.allowance_expiry_ledger <= ledger + 10) {
      this.askRenewal(userId, want, "expired");
      return { ok: false, reason: "allowance_expired", needed: want };
    }
    if (allowance < want) {
      this.askRenewal(userId, want, "amount");
      return { ok: false, reason: "allowance_amount", needed: want, detail: `allowance ${toFloat(allowance)} < ${toFloat(want)}` };
    }
    const use = want > balance ? balance : want;
    const debt = await this.d.credit.usdcDebt(userId);
    const rule = this.d.db.rule(userId);
    const repay = rule.repay_first ? debt : 0n;
    try {
      const ref = await this.d.chain.settleSalary(vault, use, repay);
      const repaid = repay > use ? use : repay;
      const added = use - repaid;
      this.d.db.setAllowance(userId, allowance - use, user.allowance_expiry_ledger);
      this.d.credit.invalidate(userId);
      this.d.db.notify(
        userId,
        "salary_settled",
        "Maaş geldi",
        repaid > 0n
          ? `${toFloat(repaid).toFixed(2)} USDC borç kapandı, ${toFloat(added).toFixed(2)} USDC Kazan'a eklendi. hUSDY/hXAU dağılımını onayla.`
          : `${toFloat(added).toFixed(2)} USDC Kazan'a eklendi. hUSDY/hXAU dağılımını onayla.`,
        { tx: ref.hash, amount: use.toString(), repaid: repaid.toString(), added: added.toString(), allocation: JSON.parse(rule.allocation) },
      );
      this.d.log?.(`salary settled for ${userId}: ${toFloat(use)} USDC, repaid ${toFloat(repaid)}, tx ${ref.hash}`);
      return { ok: true, tx: ref.hash, amount: use, repaid, collateralAdded: added };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.d.log?.(`settle_salary failed for ${userId}: ${msg}`);
      return { ok: false, reason: "error", detail: msg };
    }
  }

  private askRenewal(userId: string, needed: bigint, why: "expired" | "amount") {
    this.d.db.notify(
      userId,
      "allowance_needed",
      "Maaş kuralı için onay gerekli",
      why === "expired" ? "USDC izninin süresi doldu; yenile." : `Maaş kuralı ${toFloat(needed).toFixed(2)} USDC için izin istiyor.`,
      { needed: needed.toString(), why },
    );
  }

  /** İstemci allowance verdikten sonra bildirir; DB'de takip edilir. */
  recordAllowance(userId: string, amount: bigint, expiryLedger: number) {
    this.d.db.setAllowance(userId, amount, expiryLedger);
  }
}
