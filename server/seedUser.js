import bcrypt from "bcrypt";
import { pool } from "./db.js";

async function seedUser() {
  try {
    const password = await bcrypt.hash("user123", 10);

    const result = await pool.query(
      `
      INSERT INTO users
      (
        name,
        company,
        username,
        email,
        phone,
        password_hash,
        role
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, username;
      `,
      [
        "Test User",
        "Demo Company",
        "testuser",
        "testuser@gmail.com",
        "9876543210",
        password,
        "customer"
      ]
    );

    console.log("✅ User Created!");
    console.log(result.rows[0]);
    console.log("Username: testuser");
    console.log("Password: user123");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

seedUser();