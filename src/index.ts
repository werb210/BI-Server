import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import jwt, { JwtPayload } from "jsonwebtoken";
import { Pool } from "pg";

const app = express();
app.use(cors());
app.use(express.json());

/* ================= ENV VALIDATION ================= */

const { PORT = 4002, DATABASE_URL, JWT_SECRET = "dev_secret" } = process.env;

if (!DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

/* ================= DB INIT ================= */

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bi_applications (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      business_name TEXT,
      loan_amount NUMERIC,
      loan_type TEXT,
      insured_amount NUMERIC,
      annual_premium NUMERIC,
      status TEXT DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_commissions (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES bi_applications(id),
      referrer_email TEXT,
      commission_amount NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

void initDB();

/* ================= AUTH ================= */

type UserToken = {
  email: string;
  role: string;
};

type AuthedRequest = Request & {
  user?: UserToken;
};

function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "No token" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload & UserToken;
    req.user = { email: decoded.email, role: decoded.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function roleMiddleware(role: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "No token" });
    }

    if (req.user.role !== role && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}

/* ================= AUTH ROUTE ================= */

app.post("/bi/auth/login", async (req: Request, res: Response) => {
  const { email, role } = req.body as { email: string; role: string };

  await pool.query(
    `INSERT INTO bi_users (email, role)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, role]
  );

  const token = jwt.sign({ email, role }, JWT_SECRET, { expiresIn: "8h" });

  res.json({ token });
});

/* ================= APPLICATION SUBMISSION ================= */

app.post("/bi/applications", async (req: Request, res: Response) => {
  const {
    name,
    email,
    businessName,
    loanAmount,
    loanType,
    insuredAmount,
    annualPremium,
    referrerEmail
  } = req.body as {
    name: string;
    email: string;
    businessName: string;
    loanAmount: number;
    loanType: string;
    insuredAmount: number;
    annualPremium: number;
    referrerEmail?: string;
  };

  const result = await pool.query<{ id: number }>(
    `INSERT INTO bi_applications
     (name, email, business_name, loan_amount, loan_type, insured_amount, annual_premium)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [name, email, businessName, loanAmount, loanType, insuredAmount, annualPremium]
  );

  const appId = result.rows[0].id;

  if (referrerEmail) {
    const commission = annualPremium * 0.1;

    await pool.query(
      `INSERT INTO bi_commissions
       (application_id, referrer_email, commission_amount)
       VALUES ($1,$2,$3)`,
      [appId, referrerEmail, commission]
    );
  }

  res.json({ success: true, id: appId });
});

/* ================= GET APPLICATIONS ================= */

app.get("/bi/applications", authMiddleware, async (req: AuthedRequest, res: Response) => {
  const { role, email } = req.user as UserToken;

  if (role === "lender" || role === "admin") {
    const data = await pool.query(`SELECT * FROM bi_applications ORDER BY created_at DESC`);
    return res.json(data.rows);
  }

  if (role === "referrer") {
    const data = await pool.query(
      `SELECT a.*
       FROM bi_applications a
       JOIN bi_commissions c ON a.id = c.application_id
       WHERE c.referrer_email = $1`,
      [email]
    );
    return res.json(data.rows);
  }

  res.status(403).json({ error: "Unauthorized" });
});

/* ================= COMMISSION ENDPOINT ================= */

app.get(
  "/bi/commission",
  authMiddleware,
  roleMiddleware("referrer"),
  async (req: AuthedRequest, res: Response) => {
    const { email } = req.user as UserToken;

    const data = await pool.query<{ total: string | null }>(
      `SELECT SUM(commission_amount) as total
       FROM bi_commissions
       WHERE referrer_email = $1`,
      [email]
    );

    res.json({ total: data.rows[0].total || 0 });
  }
);

/* ================= CONTACT ================= */

app.post("/bi/contact", (req: Request, res: Response) => {
  console.log("Contact message:", req.body);
  res.json({ success: true });
});

/* ================= STATUS UPDATE (ADMIN) ================= */

app.put(
  "/bi/applications/:id/status",
  authMiddleware,
  roleMiddleware("admin"),
  async (req: Request, res: Response) => {
    const { status } = req.body as { status: string };
    const { id } = req.params;

    await pool.query(`UPDATE bi_applications SET status = $1 WHERE id = $2`, [status, id]);

    res.json({ success: true });
  }
);

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on port ${PORT}`);
});
