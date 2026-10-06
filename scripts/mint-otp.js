// Mint a login code straight into the database.
//
// Render's free tier blocks outbound SMTP, so Gmail can't deliver the OTP from
// a deployed service. Until a transactional email API (Resend/SendGrid/Brevo,
// all HTTPS) or an SMS provider is wired in, this is how you sign in: it writes
// the same hashed, expiring record the server would have written, so the normal
// /auth/verify-otp path accepts it with no bypass in the deployed code.
//
//   MONGODB_URI="<atlas uri>" node scripts/mint-otp.js 9000000001
//
// Needs database access, which only you have — it is not a backdoor in the API.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dir, '../.env') });

const phone = process.argv[2];
if (!phone) {
  console.error('Usage: node scripts/mint-otp.js <phone>   e.g. 9000000001');
  process.exit(2);
}

const { connectDB, disconnectDB } = await import('@yatracab/core');
const { Otp } = await import('../core/src/models/Otp.js');
const { User } = await import('../core/src/models/User.js');

const TTL_MINUTES = 10;

await connectDB();

const user = await User.findOne({ phone }).select('name role email');
if (!user) {
  console.error(`No account with phone ${phone}. Seeded logins: 9000000001 (admin), 9000000010 (rider), 9000000020 (driver).`);
  await disconnectDB();
  process.exit(1);
}

const code = String(Math.floor(100000 + Math.random() * 900000));
const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

await Otp.findOneAndUpdate(
  { phone },
  { phone, codeHash: await bcrypt.hash(code, 8), purpose: 'login', attempts: 0, expiresAt },
  { upsert: true, new: true }
);

console.log(`\n  ${user.name} (${user.role})`);
console.log(`  phone  ${phone}`);
console.log(`  code   ${code}`);
console.log(`  valid  ${TTL_MINUTES} minutes\n`);

await disconnectDB();
process.exit(0);
