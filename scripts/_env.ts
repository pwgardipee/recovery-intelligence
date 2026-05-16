/**
 * Side-effect import that loads .env.local before any subsequent module
 * tries to read process.env. Import this FIRST in any script that touches
 * the database or WHOOP modules.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
