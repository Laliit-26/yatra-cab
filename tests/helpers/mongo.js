import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Start an in-memory MongoDB and connect mongoose to it.
 * Returns the server handle so the caller can stop it in afterAll.
 */
export async function startDb() {
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri);
  return server;
}

/**
 * Drop all collections, disconnect, and stop the server.
 */
export async function stopDb(server) {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await server.stop();
}

/**
 * Delete every document in every collection — use between test groups
 * within the same file to keep tests independent without restarting mongod.
 */
export async function clearDb() {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
