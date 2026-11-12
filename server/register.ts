import { hashPassword, sql } from "./db.ts";
import { passwordOk } from "./passwordPolicy.ts";

export async function registerOwnerUser(username: string, password: string): Promise<"ok" | "forbidden" | "username" | "password" | "taken"> {
  if (username === "admin") return "forbidden";
  if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(username)) return "username";
  if (!passwordOk(password)) return "password";
  const taken = await sql("select id from users where username = $1", [username]);
  if (taken.length > 0) return "taken";
  await sql(
    `insert into users (id, username, name, role, password_hash)
     values ($1, $2, $3, 'admin', $4)`,
    [crypto.randomUUID(), username, username, await hashPassword(password)],
  );
  return "ok";
}
