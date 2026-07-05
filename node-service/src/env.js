// Load environment before any other module reads process.env.
// ESM evaluates imports before sibling statements, so env loading must live in a
// module that is imported *first* — not as loose dotenv.config() calls in server.js.
import dotenv from 'dotenv';

dotenv.config();                    // node-service/.env
dotenv.config({ path: '../.env' }); // repo-root .env (fallback; never overrides)
