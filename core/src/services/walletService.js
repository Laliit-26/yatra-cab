import { Driver } from '../models/Driver.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';
import { withTransaction } from '../config/db.js';

/**
 * Driver Pay-to-Connect wallet. Every mutation is atomic and writes a ledger
 * row (WalletTransaction) with the resulting balance.
 */

export async function getWallet(driverId) {
  const [driver, txns] = await Promise.all([
    Driver.findById(driverId).select('walletBalance referralEarnings'),
    WalletTransaction.find({ driver: driverId }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  if (!driver) throw ApiError.notFound('Driver not found');
  return { balance: driver.walletBalance, referralEarnings: driver.referralEarnings, transactions: txns };
}

export async function credit(driverId, amount, reason, { ride, note } = {}) {
  const amt = Math.round(amount);
  if (amt <= 0) throw ApiError.badRequest('Amount must be positive');
  return withTransaction(async (session) => {
    const opts = session ? { session } : {};
    const driver = await Driver.findByIdAndUpdate(driverId, { $inc: { walletBalance: amt } }, { new: true, ...opts });
    if (!driver) throw ApiError.notFound('Driver not found');
    const [txn] = await WalletTransaction.create([{ driver: driverId, type: 'credit', amount: amt, reason, balanceAfter: driver.walletBalance, ride, note }], opts);
    logger.info(`[wallet] +₹${amt} (${reason}) → driver ${driverId} = ₹${driver.walletBalance}`);
    return { balance: driver.walletBalance, txn };
  });
}

/**
 * Debit with a sufficient-balance guard (conditional update → no race).
 * Returns { ok:false } when the balance is too low instead of throwing, so
 * callers can prompt a top-up.
 */
export async function debit(driverId, amount, reason, { ride, note } = {}) {
  const amt = Math.round(amount);
  if (amt <= 0) throw ApiError.badRequest('Amount must be positive');
  return withTransaction(async (session) => {
    const opts = session ? { session } : {};
    const driver = await Driver.findOneAndUpdate(
      { _id: driverId, walletBalance: { $gte: amt } },
      { $inc: { walletBalance: -amt } },
      { new: true, ...opts }
    );
    if (!driver) {
      const current = await Driver.findById(driverId, null, opts).select('walletBalance');
      return { ok: false, balance: current?.walletBalance ?? 0, shortBy: amt - (current?.walletBalance ?? 0) };
    }
    const [txn] = await WalletTransaction.create([{ driver: driverId, type: 'debit', amount: amt, reason, balanceAfter: driver.walletBalance, ride, note }], opts);
    logger.info(`[wallet] -₹${amt} (${reason}) → driver ${driverId} = ₹${driver.walletBalance}`);
    return { ok: true, balance: driver.walletBalance, txn };
  });
}

/** Mock top-up (swap for a real gateway later — mirrors the payment service). */
export async function topup(driverId, amount) {
  return credit(driverId, amount, 'topup', { note: 'Wallet top-up (mock)' });
}
