import { computeBillShares, type BillComputation } from './computeBill';
import { computeBillDebtsDetailed, greedyMatch } from './computeDebts';
import { sumMoney } from './money';
import type { Bill, Debt, Member, Money, Settlement, Waiver } from './types';

/**
 * settle.ts — รวมทุกบิลในทริป หักการชำระ/ยกเว้น แล้วตอบว่า
 * "ตอนนี้ใครติดใคร" (netByPair) และ "โอนกี่ครั้งจบ" (settlementPlan)
 */

export interface PairNet {
  from: string;
  to: string;
  amount: Money;
  /** หนี้รวมก่อนหักการชำระของคู่นี้ (ทิศทาง from → to) */
  gross: Money;
  /** ที่ชำระไปแล้วในทิศทาง from → to */
  settled: Money;
  /** ที่ยกเว้นในทิศทาง from → to */
  waived: Money;
}

export interface MemberSummary {
  memberId: string;
  /** จ่ายให้ร้านไปเท่าไร */
  paid: Money;
  /** ส่วนที่ต้องรับผิดชอบ */
  share: Money;
  /** paid - share */
  net: Money;
  /** โอนคืนคนอื่นไปแล้วเท่าไร */
  settledOut: Money;
  /** รับคืนจากคนอื่นแล้วเท่าไร */
  settledIn: Money;
  waivedOut: Money;
  waivedIn: Money;
  /** ยอดสุทธิตอนนี้: + = ควรได้คืน, − = ต้องจ่าย */
  balance: Money;
}

export interface TripTotals {
  /** ค่าใช้จ่ายรวมทั้งทริป (ยอดบนบิลทุกใบ) */
  tripTotal: Money;
  /** ยอดที่ต้องได้รับคืนทั้งหมด (ผลรวมของ balance ที่เป็นบวก) */
  toCollect: Money;
  /** คืนกันไปแล้วเท่าไร */
  settledTotal: Money;
  /** ยกเว้นไปแล้วเท่าไร */
  waivedTotal: Money;
  /** ยังค้างอยู่เท่าไร (ผลรวมของ balance ที่เป็นบวก ณ ตอนนี้) */
  outstanding: Money;
}

export interface BillEvaluation {
  bill: Bill;
  computation: BillComputation;
  debts: Debt[];
  paid: Record<string, Money>;
  /** true = บิลใบนี้คำนวณไม่ผ่าน จึงไม่ถูกนับเข้าหนี้ */
  skipped: boolean;
  problems: string[];
}

export interface Outstanding {
  grossDebts: Debt[];
  netByPair: PairNet[];
  settlementPlan: Debt[];
  perMember: MemberSummary[];
  balances: Record<string, Money>;
  totals: TripTotals;
  bills: BillEvaluation[];
  problems: string[];
}

export interface OutstandingInput {
  members: Member[];
  bills: Bill[];
  settlements: Settlement[];
  waivers: Waiver[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function computeOutstanding(input: OutstandingInput): Outstanding {
  const { members, bills, settlements, waivers } = input;
  const memberIds = members.map((m) => m.id);

  const emptyMoneyMap = (): Record<string, Money> =>
    Object.fromEntries(memberIds.map((id) => [id, 0]));

  const paidTotals = emptyMoneyMap();
  const shareTotals = emptyMoneyMap();
  const grossDebts: Debt[] = [];
  const evaluations: BillEvaluation[] = [];
  const problems: string[] = [];

  // 1) รวมหนี้จากทุกบิล
  for (const bill of bills) {
    const computation = computeBillShares(bill, members);
    const billProblems = computation.issues.map((issue) => issue.message);

    if (!computation.ok) {
      problems.push(`${bill.title}: ${billProblems.join(' / ')}`);
      evaluations.push({
        bill,
        computation,
        debts: [],
        paid: {},
        skipped: true,
        problems: billProblems,
      });
      continue;
    }

    const detailed = computeBillDebtsDetailed(bill, computation.shares);
    for (const issue of detailed.issues) billProblems.push(issue.message);
    if (detailed.issues.some((issue) => issue.code === 'payersMismatch')) {
      problems.push(`${bill.title}: ${detailed.issues[0].message}`);
    }

    for (const [memberId, amount] of Object.entries(computation.shares)) {
      shareTotals[memberId] = (shareTotals[memberId] ?? 0) + amount;
    }
    for (const [memberId, amount] of Object.entries(detailed.paid)) {
      paidTotals[memberId] = (paidTotals[memberId] ?? 0) + amount;
    }
    grossDebts.push(...detailed.debts);

    evaluations.push({
      bill,
      computation,
      debts: detailed.debts,
      paid: detailed.paid,
      skipped: false,
      problems: billProblems,
    });
  }

  // 2) หัก settlement และ waiver
  const balances: Record<string, Money> = emptyMoneyMap();
  for (const debt of grossDebts) {
    balances[debt.from] = (balances[debt.from] ?? 0) - debt.amount;
    balances[debt.to] = (balances[debt.to] ?? 0) + debt.amount;
  }

  const settledOut = emptyMoneyMap();
  const settledIn = emptyMoneyMap();
  const waivedOut = emptyMoneyMap();
  const waivedIn = emptyMoneyMap();

  for (const settlement of settlements) {
    balances[settlement.fromMemberId] = (balances[settlement.fromMemberId] ?? 0) + settlement.amount;
    balances[settlement.toMemberId] = (balances[settlement.toMemberId] ?? 0) - settlement.amount;
    settledOut[settlement.fromMemberId] = (settledOut[settlement.fromMemberId] ?? 0) + settlement.amount;
    settledIn[settlement.toMemberId] = (settledIn[settlement.toMemberId] ?? 0) + settlement.amount;
  }
  for (const waiver of waivers) {
    balances[waiver.fromMemberId] = (balances[waiver.fromMemberId] ?? 0) + waiver.amount;
    balances[waiver.toMemberId] = (balances[waiver.toMemberId] ?? 0) - waiver.amount;
    waivedOut[waiver.fromMemberId] = (waivedOut[waiver.fromMemberId] ?? 0) + waiver.amount;
    waivedIn[waiver.toMemberId] = (waivedIn[waiver.toMemberId] ?? 0) + waiver.amount;
  }

  // 3) หักลบรายคู่
  const netByPair = computeNetByPair(grossDebts, settlements, waivers);

  // 4) แผนโอนที่จำนวนครั้งน้อยที่สุด
  const settlementPlan = greedyMatch(balances);

  const perMember: MemberSummary[] = [...new Set([...memberIds, ...Object.keys(balances)])]
    .sort()
    .map((memberId) => ({
      memberId,
      paid: paidTotals[memberId] ?? 0,
      share: shareTotals[memberId] ?? 0,
      net: (paidTotals[memberId] ?? 0) - (shareTotals[memberId] ?? 0),
      settledOut: settledOut[memberId] ?? 0,
      settledIn: settledIn[memberId] ?? 0,
      waivedOut: waivedOut[memberId] ?? 0,
      waivedIn: waivedIn[memberId] ?? 0,
      balance: balances[memberId] ?? 0,
    }));

  const totals: TripTotals = {
    tripTotal: sumMoney(bills.map((bill) => bill.statedTotal)),
    toCollect: sumMoney(
      perMember.map((m) => Math.max(0, m.net)),
    ),
    settledTotal: sumMoney(settlements.map((s) => s.amount)),
    waivedTotal: sumMoney(waivers.map((w) => w.amount)),
    outstanding: sumMoney(perMember.map((m) => Math.max(0, m.balance))),
  };

  assertBalanced(balances);

  return {
    grossDebts,
    netByPair,
    settlementPlan,
    perMember,
    balances,
    totals,
    bills: evaluations,
    problems,
  };
}

export function computeNetByPair(
  grossDebts: Debt[],
  settlements: Settlement[] = [],
  waivers: Waiver[] = [],
): PairNet[] {
  interface Bucket {
    a: string;
    b: string;
    /** สุทธิในทิศทาง a → b */
    net: Money;
    grossAB: Money;
    grossBA: Money;
    settledAB: Money;
    settledBA: Money;
    waivedAB: Money;
    waivedBA: Money;
  }
  const buckets = new Map<string, Bucket>();

  const bucketFor = (x: string, y: string): Bucket => {
    const key = pairKey(x, y);
    let bucket = buckets.get(key);
    if (!bucket) {
      const [a, b] = x < y ? [x, y] : [y, x];
      bucket = {
        a,
        b,
        net: 0,
        grossAB: 0,
        grossBA: 0,
        settledAB: 0,
        settledBA: 0,
        waivedAB: 0,
        waivedBA: 0,
      };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const debt of grossDebts) {
    const bucket = bucketFor(debt.from, debt.to);
    const forward = debt.from === bucket.a;
    bucket.net += forward ? debt.amount : -debt.amount;
    if (forward) bucket.grossAB += debt.amount;
    else bucket.grossBA += debt.amount;
  }

  for (const settlement of settlements) {
    const bucket = bucketFor(settlement.fromMemberId, settlement.toMemberId);
    const forward = settlement.fromMemberId === bucket.a;
    bucket.net += forward ? -settlement.amount : settlement.amount;
    if (forward) bucket.settledAB += settlement.amount;
    else bucket.settledBA += settlement.amount;
  }

  for (const waiver of waivers) {
    const bucket = bucketFor(waiver.fromMemberId, waiver.toMemberId);
    const forward = waiver.fromMemberId === bucket.a;
    bucket.net += forward ? -waiver.amount : waiver.amount;
    if (forward) bucket.waivedAB += waiver.amount;
    else bucket.waivedBA += waiver.amount;
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.net !== 0)
    .map((bucket) => {
      const forward = bucket.net > 0;
      const from = forward ? bucket.a : bucket.b;
      const to = forward ? bucket.b : bucket.a;
      return {
        from,
        to,
        amount: Math.abs(bucket.net),
        gross: forward ? bucket.grossAB : bucket.grossBA,
        settled: forward ? bucket.settledAB : bucket.settledBA,
        waived: forward ? bucket.waivedAB : bucket.waivedBA,
      };
    })
    .sort((x, y) => y.amount - x.amount || (x.from < y.from ? -1 : 1));
}

/** ใน dev/test ให้ invariant ที่ผิดพลาด throw ทันที; production ให้ log แทน */
let strictInvariants = true;

export function setStrictInvariants(value: boolean): void {
  strictInvariants = value;
}

/** ผลรวม balance ของทุกคนต้องเป็น 0 เสมอ — ถ้าไม่เท่าแปลว่ามีบั๊ก */
export function assertBalanced(balances: Record<string, Money>): void {
  const total = sumMoney(Object.values(balances));
  if (total === 0) return;
  const message = `ผลรวม balance ต้องเป็น 0 แต่ได้ ${total} สตางค์ — มีบั๊กในการคำนวณ`;
  if (strictInvariants) throw new Error(message);
  console.error(message, balances);
}
