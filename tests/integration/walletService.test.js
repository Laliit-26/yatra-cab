import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startDb, stopDb, clearDb } from '../helpers/mongo.js';
import { Driver } from '../../core/src/models/Driver.js';
import { WalletTransaction } from '../../core/src/models/WalletTransaction.js';
import { credit, debit, getWallet, topup } from '../../core/src/services/walletService.js';

// ── test fixture ──────────────────────────────────────────────────────────────

let mongoServer;

async function makeDriver(initialBalance = 0) {
  const d = await Driver.create({
    user: new mongoose.Types.ObjectId(),
    vehicle: { type: 'sedan' },
    walletBalance: initialBalance,
  });
  return d;
}

beforeAll(async () => {
  mongoServer = await startDb();
});

afterAll(async () => {
  await stopDb(mongoServer);
});

beforeEach(async () => {
  await clearDb();
});

// ── credit ────────────────────────────────────────────────────────────────────

describe('credit', () => {
  it('increases walletBalance by the credited amount', async () => {
    const driver = await makeDriver(100);
    const result = await credit(driver._id, 50, 'topup');
    expect(result.balance).toBe(150);

    const updated = await Driver.findById(driver._id).select('walletBalance');
    expect(updated.walletBalance).toBe(150);
  });

  it('writes a ledger row with correct fields', async () => {
    const driver = await makeDriver(0);
    const { txn } = await credit(driver._id, 200, 'bonus', { note: 'welcome' });
    expect(txn.type).toBe('credit');
    expect(txn.amount).toBe(200);
    expect(txn.reason).toBe('bonus');
    expect(txn.balanceAfter).toBe(200);
    expect(String(txn.driver)).toBe(String(driver._id));
  });

  it('rounds fractional amounts to whole rupees', async () => {
    const driver = await makeDriver(0);
    const result = await credit(driver._id, 99.7, 'topup');
    expect(result.balance).toBe(100); // Math.round(99.7) = 100
  });

  it('accumulates correctly across multiple credits', async () => {
    const driver = await makeDriver(0);
    await credit(driver._id, 100, 'topup');
    await credit(driver._id, 50, 'bonus');
    const { balance } = await getWallet(driver._id);
    expect(balance).toBe(150);
  });

  it('throws ApiError 400 when amount is zero', async () => {
    const driver = await makeDriver(0);
    await expect(credit(driver._id, 0, 'topup')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws ApiError 400 when amount is negative', async () => {
    const driver = await makeDriver(100);
    await expect(credit(driver._id, -10, 'topup')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws ApiError 404 when driver does not exist', async () => {
    const ghostId = new mongoose.Types.ObjectId();
    await expect(credit(ghostId, 100, 'topup')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── debit ─────────────────────────────────────────────────────────────────────

describe('debit', () => {
  it('decreases walletBalance and returns { ok: true }', async () => {
    const driver = await makeDriver(500);
    const result = await debit(driver._id, 200, 'commission');
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(300);

    const updated = await Driver.findById(driver._id).select('walletBalance');
    expect(updated.walletBalance).toBe(300);
  });

  it('writes a ledger row with type=debit', async () => {
    const driver = await makeDriver(500);
    const { txn } = await debit(driver._id, 200, 'commission');
    expect(txn.type).toBe('debit');
    expect(txn.amount).toBe(200);
    expect(txn.balanceAfter).toBe(300);
  });

  it('succeeds when amount exactly equals the balance', async () => {
    const driver = await makeDriver(100);
    const result = await debit(driver._id, 100, 'commission');
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(0);
  });

  it('returns { ok: false } and does not change balance when funds are insufficient', async () => {
    const driver = await makeDriver(50);
    const result = await debit(driver._id, 200, 'commission');
    expect(result.ok).toBe(false);
    expect(result.balance).toBe(50); // unchanged

    const current = await Driver.findById(driver._id).select('walletBalance');
    expect(current.walletBalance).toBe(50); // definitely unchanged
  });

  it('shortBy is correctly computed when insufficient', async () => {
    const driver = await makeDriver(30);
    const result = await debit(driver._id, 100, 'commission');
    expect(result.ok).toBe(false);
    expect(result.shortBy).toBe(70); // 100 - 30
  });

  it('creates no WalletTransaction on insufficient balance', async () => {
    const driver = await makeDriver(10);
    await debit(driver._id, 100, 'commission');
    const txns = await WalletTransaction.find({ driver: driver._id });
    expect(txns).toHaveLength(0);
  });

  it('throws ApiError 400 when amount is zero', async () => {
    const driver = await makeDriver(100);
    await expect(debit(driver._id, 0, 'commission')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws ApiError 400 when amount is negative', async () => {
    const driver = await makeDriver(100);
    await expect(debit(driver._id, -50, 'commission')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rounds fractional amounts (deduct ceil value to protect balance)', async () => {
    const driver = await makeDriver(200);
    // Math.round(99.5) = 100; deducting 100 from 200 = 100
    const result = await debit(driver._id, 99.5, 'commission');
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(100);
  });

  it('KNOWN BEHAVIOUR: returns ok:false (not ApiError 404) when driver does not exist', async () => {
    // `debit` silently returns ok:false for non-existent drivers while `credit`
    // throws a 404. Callers checking only `ok` cannot distinguish insufficient-
    // balance from driver-not-found. Consider aligning the two functions.
    const ghostId = new mongoose.Types.ObjectId();
    const result = await debit(ghostId, 50, 'commission');
    expect(result.ok).toBe(false);
    expect(result.balance).toBe(0);
  });

  it('race safety: concurrent debits only one succeeds when balance covers only one', async () => {
    const driver = await makeDriver(100);
    // Two concurrent debit(100) attempts — only one can succeed.
    const [r1, r2] = await Promise.all([
      debit(driver._id, 100, 'commission'),
      debit(driver._id, 100, 'commission'),
    ]);
    const successes = [r1, r2].filter((r) => r.ok === true);
    const failures = [r1, r2].filter((r) => r.ok === false);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Final balance must be 0 (exactly one debit landed).
    const final = await Driver.findById(driver._id).select('walletBalance');
    expect(final.walletBalance).toBe(0);

    // Exactly one WalletTransaction should exist.
    const txns = await WalletTransaction.find({ driver: driver._id });
    expect(txns).toHaveLength(1);
  });
});

// ── getWallet ─────────────────────────────────────────────────────────────────

describe('getWallet', () => {
  it('returns current balance and transaction list', async () => {
    const driver = await makeDriver(500);
    await credit(driver._id, 200, 'topup');
    await debit(driver._id, 100, 'commission');

    const wallet = await getWallet(driver._id);
    expect(wallet.balance).toBe(600); // 500 + 200 - 100
    expect(wallet.transactions).toHaveLength(2);
    // Most recent first
    expect(wallet.transactions[0].type).toBe('debit');
    expect(wallet.transactions[1].type).toBe('credit');
  });

  it('throws ApiError 404 for a non-existent driver', async () => {
    await expect(getWallet(new mongoose.Types.ObjectId())).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── topup ─────────────────────────────────────────────────────────────────────

describe('topup', () => {
  it('is a credit with reason=topup', async () => {
    const driver = await makeDriver(0);
    const { txn } = await topup(driver._id, 300);
    expect(txn.reason).toBe('topup');
    expect(txn.amount).toBe(300);
  });
});
