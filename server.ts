import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { db } from "./src/db/index.ts";
import { clients, projects, sessions, users } from "./src/db/schema.ts";
import { eq, inArray, and } from "drizzle-orm";
import { adminAuth } from "./src/lib/firebase-admin.ts";
import { getOrCreateUser } from "./src/db/users.ts";

let currentDirname = process.cwd();
try {
  if (typeof __dirname !== "undefined") {
    currentDirname = __dirname;
  }
} catch (e) {}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Freelance en Apuros Backend is running on Cloud SQL" });
  });

  // Helper function to resolve user context (supports custom token or fallback demo user context)
  async function getUserContext(req: express.Request) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      try {
        const decodedToken = await adminAuth.verifyIdToken(token);
        const email = decodedToken.email || `${decodedToken.uid}@firebase.auth`;
        // Sync or get existing user in our PostgreSQL database
        const dbUser = await getOrCreateUser(decodedToken.uid, email);
        return dbUser;
      } catch (error) {
        console.warn("Invalid token in request, falling back to system demo user context", error);
      }
    }
    // Fallback to system demo user context so the app starts fully functional with Postgres out of the box
    return await getOrCreateUser("system_demo_user", "demo@freelanceenapuros.cl");
  }

  // 1. GET /api/data : Retrieves all clients, projects, and sessions for resolved user
  app.get("/api/data", async (req, res) => {
    try {
      const user = await getUserContext(req);
      
      // Fetch clients
      const dbClients = await db.select().from(clients).where(eq(clients.userId, user.id));
      
      const clientIds = dbClients.map(c => c.id);
      
      if (clientIds.length === 0) {
        return res.json({ clients: [], projects: [], sessions: [] });
      }

      // Fetch projects
      const dbProjects = await db.select().from(projects).where(inArray(projects.clientId, clientIds));
      const projectIds = dbProjects.map(p => p.id);

      // Fetch sessions
      let dbSessions: any[] = [];
      if (projectIds.length > 0) {
        dbSessions = await db.select().from(sessions).where(inArray(sessions.projectId, projectIds));
      }

      // Map back to client-friendly state structures if needed, but since keys align, we can return directly
      res.json({
        clients: dbClients,
        projects: dbProjects,
        sessions: dbSessions
      });
    } catch (error: any) {
      console.error("Database fetch failed:", error);
      res.status(500).json({ error: "Database operation failed. Could not fetch data.", details: error.message });
    }
  });

  // 2. POST /api/clients : Add single client and its default project
  app.post("/api/clients", async (req, res) => {
    try {
      const user = await getUserContext(req);
      const { id, rut, name, email, defaultTariff, onboardingDate, lastActiveDate } = req.body;

      if (!id || !rut || !name) {
        return res.status(400).json({ error: "Missing required client fields (id, rut, name)" });
      }

      // Safe creation block
      const result = await db.insert(clients).values({
        id,
        userId: user.id,
        rut,
        name,
        email: email || `${name.toLowerCase().replace(/ /g, '')}@example.cl`,
        defaultTariff: parseInt(defaultTariff) || 30000,
        onboardingDate: onboardingDate || Date.now(),
        lastActiveDate: lastActiveDate || Date.now()
      }).onConflictDoUpdate({
        target: clients.id,
        set: {
          rut,
          name,
          email: email || `${name.toLowerCase().replace(/ /g, '')}@example.cl`,
          defaultTariff: parseInt(defaultTariff) || 30000,
          onboardingDate: onboardingDate || Date.now(),
          lastActiveDate: lastActiveDate || Date.now()
        }
      }).returning();

      // Create primary project for client
      const projectId = id + "_proj";
      await db.insert(projects).values({
        id: projectId,
        clientId: id,
        name: `Proyecto Base ${name}`,
        status: 'ACTIVE'
      }).onConflictDoNothing();

      res.json({ success: true, client: result[0] });
    } catch (error: any) {
      console.error("Database insert failed for client:", error);
      res.status(500).json({ error: "Database operation failed. Could not create client.", details: error.message });
    }
  });

  // 3. POST /api/sessions : Add single session
  app.post("/api/sessions", async (req, res) => {
    try {
      const user = await getUserContext(req);
      const { id, projectId, startTime, endTime, durationHours, tariffCLP, documentType, billingStatus, issuedAt, paidAt, taxData } = req.body;

      if (!id || !projectId || !startTime || !endTime) {
        return res.status(400).json({ error: "Missing required session fields" });
      }

      await db.insert(sessions).values({
        id,
        projectId,
        startTime,
        endTime,
        durationHours: parseFloat(durationHours),
        tariffCLP: parseInt(tariffCLP),
        documentType,
        billingStatus,
        issuedAt: issuedAt || null,
        paidAt: paidAt || null,
        taxData
      }).onConflictDoUpdate({
        target: sessions.id,
        set: {
          billingStatus,
          issuedAt: issuedAt || null,
          paidAt: paidAt || null,
          taxData
        }
      });

      // Automatically update the client's last active date
      const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (proj) {
        await db.update(clients)
          .set({ lastActiveDate: endTime })
          .where(eq(clients.id, proj.clientId));
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Database insert failed for session:", error);
      res.status(500).json({ error: "Database operation failed. Could not create session.", details: error.message });
    }
  });

  // 4. POST /api/sync : Sync complete client state including CSV bulk load representation
  app.post("/api/sync", async (req, res) => {
    try {
      const user = await getUserContext(req);
      const { clients: clientsList, projects: projectsList, sessions: sessionsList } = req.body;

      if (clientsList && clientsList.length > 0) {
        for (const c of clientsList) {
          await db.insert(clients).values({
            id: c.id,
            userId: user.id,
            rut: c.rut,
            name: c.name,
            email: c.email || `${c.name.toLowerCase().replace(/ /g, '')}@example.cl`,
            defaultTariff: parseInt(c.defaultTariff) || 30000,
            onboardingDate: c.onboardingDate || Date.now(),
            lastActiveDate: c.lastActiveDate || Date.now()
          }).onConflictDoUpdate({
            target: clients.id,
            set: {
              rut: c.rut,
              name: c.name,
              email: c.email || `${c.name.toLowerCase().replace(/ /g, '')}@example.cl`,
              defaultTariff: parseInt(c.defaultTariff) || 30000,
              onboardingDate: c.onboardingDate || Date.now(),
              lastActiveDate: c.lastActiveDate || Date.now()
            }
          });
        }
      }

      if (projectsList && projectsList.length > 0) {
        for (const p of projectsList) {
          await db.insert(projects).values({
            id: p.id,
            clientId: p.clientId,
            name: p.name,
            description: p.description || null,
            status: p.status || 'ACTIVE'
          }).onConflictDoUpdate({
            target: projects.id,
            set: {
              name: p.name,
              description: p.description || null,
              status: p.status || 'ACTIVE'
            }
          });
        }
      }

      if (sessionsList && sessionsList.length > 0) {
        for (const s of sessionsList) {
          await db.insert(sessions).values({
            id: s.id,
            projectId: s.projectId,
            startTime: s.startTime,
            endTime: s.endTime,
            durationHours: parseFloat(s.durationHours) || 0,
            tariffCLP: parseInt(s.tariffCLP) || 3000,
            documentType: s.documentType,
            billingStatus: s.billingStatus,
            issuedAt: s.issuedAt || null,
            paidAt: s.paidAt || null,
            taxData: s.taxData
          }).onConflictDoUpdate({
            target: sessions.id,
            set: {
              billingStatus: s.billingStatus,
              issuedAt: s.issuedAt || null,
              paidAt: s.paidAt || null,
              taxData: s.taxData
            }
          });
        }
      }

      res.json({ success: true, message: "Sync successful" });
    } catch (error: any) {
      console.error("Database bulk sync failed:", error);
      res.status(500).json({ error: "Failed to perform bulk sync on Cloud SQL", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Robustly check and locate the correct dist path
    let distPath = path.join(process.cwd(), "dist");
    if (!fs.existsSync(distPath)) {
      distPath = path.join(currentDirname, "../dist");
    }
    if (!fs.existsSync(distPath)) {
      distPath = path.join(currentDirname, "dist");
    }
    if (!fs.existsSync(distPath)) {
      distPath = "/app/dist";
    }
    
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexFile = path.join(distPath, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Application dist/index.html not found.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
