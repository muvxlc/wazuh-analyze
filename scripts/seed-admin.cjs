require('dotenv/config');
const { Pool } = require('pg');
const argon2 = require('argon2');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL");
  
  const pool = new Pool({ connectionString: url });
  
  const email = process.argv[2] || "admin@wazuh-dashboard.local";
  const password = process.argv[3] || "SuperAdmin123!";
  
  try {
    const res = await pool.query('SELECT id FROM users WHERE normalized_email = $1', [email.toLowerCase()]);
    if (res.rows.length > 0) {
      console.log(`User ${email} already exists.`);
      return;
    }
    
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });
    
    await pool.query(
      `INSERT INTO users (email, normalized_email, display_name, password_hash, role, locale, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [email, email.toLowerCase(), "Super Admin", passwordHash, "super_admin", "en", true]
    );
    
    console.log(`Created super_admin user successfully:`);
    console.log(`Email: ${email}`);
    console.log(`PLEASE LOG IN AND CHANGE YOUR PASSWORD IMMEDIATELY.`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
