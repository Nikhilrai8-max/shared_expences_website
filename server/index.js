import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { analyzeCSV, normalizeName, validateDate, validateMembership } from './services/importer.js';
import { calculateBalances, getLedger, getExchangeRate } from './services/calculations.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';

function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Malformed Authorization header' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;
const PID_FILE = path.resolve(process.cwd(), 'dev.pid');

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow uploading CSV content in body

// --- UTILITY: Get User Helper ---
async function findUserByName(name) {
  const normalized = normalizeName(name);
  return prisma.user.findUnique({
    where: { name: normalized }
  });
}

// --- API ROUTES ---

// 1. Get all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// 1.1 Create a new User (Register flatmate)
app.post('/api/users', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'User name is required' });
    }
    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email ? email.trim() : `${name.trim().toLowerCase()}@flatmates.com`,
      },
    });
    res.json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user. Name might already be taken.' });
  }
});

// --- AUTH: Register/Login (JWT) ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
    const hash = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { name: name.trim(), email: email ? email.trim() : undefined, password: hash },
    });
    const userSafe = { id: newUser.id, name: newUser.name, email: newUser.email };
    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: userSafe, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if ((!name && !email) || !password) return res.status(400).json({ error: 'Provide name/email and password' });
    const user = await prisma.user.findFirst({ where: { OR: [{ name: name || '' }, { email: email || '' }] } });
    if (!user || !user.password) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    const userSafe = { id: user.id, name: user.name, email: user.email };
    res.json({ user: userSafe, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// 2. Get all groups
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await prisma.group.findMany({
      include: {
        memberships: {
          include: {
            user: true,
          },
        },
      },
    });
    res.json(groups);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// 3. Get group members
app.get('/api/groups/:groupId/members', async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const memberships = await prisma.membership.findMany({
      where: { groupId },
      include: { user: true },
    });
    res.json(memberships.map(m => ({
      userId: m.userId,
      name: m.user.name,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
    })));
  } catch (error) {
    console.error('Error fetching group members:', error);
    res.status(500).json({ error: 'Failed to fetch group members' });
  }
});

// 2.1 Create a new group
app.post('/api/groups', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await prisma.group.create({
      data: {
        name,
        description,
      },
    });
    res.json(group);
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group. Name might already exist.' });
  }
});

// 3.1 Add a member to a group
app.post('/api/groups/:groupId/members', authenticateToken, async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const { userId, joinedAt } = req.body;

    if (!userId || !joinedAt) {
      return res.status(400).json({ error: 'User ID and join date are required' });
    }

    // Check if membership already exists
    const existing = await prisma.membership.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: parseInt(userId, 10),
        },
      },
    });

    if (existing) {
      // If they already exist, we can update their joinedAt and clear leftAt to re-add them
      const updated = await prisma.membership.update({
        where: { id: existing.id },
        data: {
          joinedAt: new Date(joinedAt),
          leftAt: null,
        },
      });
      return res.json(updated);
    }

    const newMembership = await prisma.membership.create({
      data: {
        groupId,
        userId: parseInt(userId, 10),
        joinedAt: new Date(joinedAt),
      },
    });
    res.json(newMembership);
  } catch (error) {
    console.error('Error adding member to group:', error);
    res.status(500).json({ error: 'Failed to add member to group' });
  }
});

// 3.2 Set a leave date for a group member (Soft leave)
app.post('/api/groups/:groupId/members/:userId/leave', async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = parseInt(req.params.userId, 10);
    const { leftAt } = req.body;

    if (!leftAt) {
      return res.status(400).json({ error: 'Leave date is required' });
    }

    const membership = await prisma.membership.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!membership) {
      return res.status(404).json({ error: 'Membership not found' });
    }

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: {
        leftAt: new Date(leftAt),
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('Error setting member leave date:', error);
    res.status(500).json({ error: 'Failed to set member leave date' });
  }
});

// 4. Get group wise balances and simplified debts
app.get('/api/groups/:groupId/balances', async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const balancesData = await calculateBalances(groupId, prisma);
    res.json(balancesData);
  } catch (error) {
    console.error('Error calculating balances:', error);
    res.status(500).json({ error: 'Failed to calculate balances' });
  }
});

// 5. Get detailed balance ledger for a member
app.get('/api/groups/:groupId/members/:userId/ledger', async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = parseInt(req.params.userId, 10);
    const ledger = await getLedger(groupId, userId, prisma);
    res.json(ledger);
  } catch (error) {
    console.error('Error generating ledger:', error);
    res.status(500).json({ error: error.message || 'Failed to generate ledger' });
  }
});

// 6. Record a manual expense
app.post('/api/expenses', authenticateToken, async (req, res) => {
  try {
    const { groupId, description, amount, currency, date, paidById, splitType, participants, shares } = req.body;

    // Split validation and parsing
    if (!participants || participants.length === 0) {
      return res.status(400).json({ error: 'Expense must have at least one participant' });
    }

    const expenseDate = new Date(date);

    // Create Expense in database using a transaction
    const newExpense = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          groupId,
          description,
          amount: parseFloat(amount),
          currency: currency.toUpperCase(),
          date: expenseDate,
          paidById,
          splitType,
          isSettlement: false,
          status: 'APPROVED',
        },
      });

      // Split Math
      let splitAmounts = {};
      const numParticipants = participants.length;

      if (splitType === 'EQUAL') {
        const equalShare = parseFloat(amount) / numParticipants;
        participants.forEach(pId => {
          splitAmounts[pId] = { amount: equalShare, percentage: 100 / numParticipants };
        });
      } else if (splitType === 'PERCENTAGE') {
        participants.forEach((pId, index) => {
          const pct = parseFloat(shares[index]);
          const shareAmount = parseFloat(amount) * (pct / 100);
          splitAmounts[pId] = { amount: shareAmount, percentage: pct };
        });
      } else if (splitType === 'EXACT') {
        participants.forEach((pId, index) => {
          const val = parseFloat(shares[index]);
          splitAmounts[pId] = { amount: val, percentage: null };
        });
      }

      // Insert splits
      for (const pId of participants) {
        await tx.split.create({
          data: {
            expenseId: expense.id,
            userId: pId,
            amount: splitAmounts[pId].amount,
            percentage: splitAmounts[pId].percentage,
          },
        });
      }

      return expense;
    });

    res.json(newExpense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// 7. Record a manual settlement
app.post('/api/settlements', authenticateToken, async (req, res) => {
  try {
    const { groupId, fromUserId, toUserId, amount, currency, date } = req.body;

    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        fromUserId,
        toUserId,
        amount: parseFloat(amount),
        currency: currency.toUpperCase(),
        date: new Date(date),
        isApproved: true,
      },
    });

    res.json(settlement);
  } catch (error) {
    console.error('Error recording settlement:', error);
    res.status(500).json({ error: 'Failed to record settlement' });
  }
});

// 8. Analyze CSV for anomalies (Staging endpoint)
app.post('/api/import/analyze', async (req, res) => {
  try {
    const { csvContent } = req.body;
    if (!csvContent) {
      return res.status(400).json({ error: 'CSV content is required' });
    }

    const analysis = analyzeCSV(csvContent);

    // Save anomalies in database as PENDING staging records
    await prisma.importAnomaly.deleteMany({
      where: { resolvedStatus: 'PENDING' }
    });

    const savedAnomalies = [];
    for (const anomaly of analysis.anomalies) {
      const saved = await prisma.importAnomaly.create({
        data: {
          csvRow: anomaly.csvRow,
          csvId: String(anomaly.csvId || ''),
          date: anomaly.date,
          description: anomaly.description,
          amount: anomaly.amount,
          currency: anomaly.currency,
          paidBy: anomaly.paidBy,
          splitType: anomaly.splitType,
          participants: anomaly.participants,
          shares: anomaly.shares,
          groupName: anomaly.groupName,
          issueType: anomaly.issueType,
          message: anomaly.message,
          resolvedStatus: 'PENDING',
          proposedFix: anomaly.proposedFix,
        },
      });
      savedAnomalies.push(saved);
    }

    res.json({
      headers: analysis.headers,
      rows: analysis.rows,
      anomalies: savedAnomalies,
    });
  } catch (error) {
    console.error('Error analyzing CSV:', error);
    res.status(500).json({ error: 'Failed to parse and analyze CSV' });
  }
});

// 9. Get existing import report / history log
app.get('/api/import/report', async (req, res) => {
  try {
    const report = await prisma.importAnomaly.findMany({
      orderBy: { csvRow: 'asc' },
    });
    res.json(report);
  } catch (error) {
    console.error('Error fetching import report:', error);
    res.status(500).json({ error: 'Failed to fetch import report' });
  }
});

// 10. Finalize the CSV import by processing the rows
app.post('/api/import/finalize', authenticateToken, async (req, res) => {
  try {
    const { resolvedRows, anomaliesLog } = req.body;

    if (!resolvedRows || resolvedRows.length === 0) {
      return res.status(400).json({ error: 'No rows provided for final ingestion' });
    }

    // Process all rows in a single database transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Clear existing dynamic expenses and settlements to prevent double importing
      // Note: We only delete expenses imported from CSV or seed to perform a clean merge
      // For this app, doing a clean reset of expenses and settlements on new imports is standard.
      await tx.split.deleteMany({});
      await tx.expense.deleteMany({});
      await tx.settlement.deleteMany({});
      await tx.importAnomaly.deleteMany({}); // Delete old staging

      // Fetch all users and groups for remapping
      const dbUsers = await tx.user.findMany();
      const dbGroups = await tx.group.findMany();

      const userMap = {};
      dbUsers.forEach(u => { userMap[u.name] = u; });

      const groupMap = {};
      dbGroups.forEach(g => { groupMap[g.name] = g; });

      let importedCount = 0;
      let skippedCount = 0;

      // 2. Iterate and process each resolved row
      for (const row of resolvedRows) {
        // Check if row is to be skipped (e.g. deleted duplicate, or skipped zero amount)
        if (row.action === 'SKIP' || row.action === 'DELETE') {
          skippedCount++;
          continue;
        }

        // Get group ID
        const rawGroup = row.groupName || 'Flat';
        const groupObj = groupMap[rawGroup];
        if (!groupObj) {
          throw new Error(`Group "${rawGroup}" not found in database. Please seed groups first.`);
        }
        const groupId = groupObj.id;

        // Resolve dates
        const dateObj = new Date(row.date);

        // Map paidBy to ID
        const payerName = normalizeName(row.paidBy);
        const payerObj = userMap[payerName];
        if (!payerObj) {
          throw new Error(`Payer "${row.paidBy}" is not registered in the database.`);
        }
        const paidById = payerObj.id;

        const amount = parseFloat(row.amountStr || row.amount);
        const currency = (row.currency || 'INR').trim().toUpperCase();

        // Check if this row is identified as a settlement
        if (row.isSettlement === true) {
          // A settlement row, e.g. Rohan settled with Aisha
          // Description format: "Settlement To Aisha" or "Transfer To Priya"
          // Let's identify the recipient from the description or participants
          let toUserName = '';
          const desc = (row.description || '').toLowerCase();
          
          if (desc.includes('to aisha') || row.participantsStr === 'Aisha') {
            toUserName = 'Aisha';
          } else if (desc.includes('to priya') || row.participantsStr === 'Priya') {
            toUserName = 'Priya';
          } else if (desc.includes('to meera') || row.participantsStr === 'Meera') {
            toUserName = 'Meera';
          } else if (desc.includes('to rohan') || row.participantsStr === 'Rohan') {
            toUserName = 'Rohan';
          } else {
            // Default recipient to first participant
            const parts = (row.participantsStr || '').split('|').map(p => normalizeName(p.trim()));
            toUserName = parts[0] || 'Aisha';
          }

          const toUserObj = userMap[toUserName];
          if (!toUserObj) {
            throw new Error(`Settlement recipient "${toUserName}" not found.`);
          }

          await tx.settlement.create({
            data: {
              groupId,
              fromUserId: paidById,
              toUserId: toUserObj.id,
              amount,
              currency,
              date: dateObj,
              isApproved: true,
            },
          });
          importedCount++;
          continue;
        }

        // If it's a negative expense amount, handle as refund (invert splits)
        let isRefund = row.isRefund || false;
        
        // standard expense
        const splitType = (row.splitType || 'EQUAL').trim().toUpperCase();
        
        // Parse participants
        let participants = (row.participantsStr || '')
          .split('|')
          .map(p => p.trim())
          .filter(p => p !== '')
          .map(normalizeName);

        // If AUTO_ALL, split among all active group members on this date
        if (row.participantsStr === 'AUTO_ALL' || participants.length === 0) {
          const memberships = await tx.membership.findMany({
            where: { groupId },
            include: { user: true },
          });
          
          // filter active members on this date
          const activeMembers = memberships.filter(m => {
            const joined = new Date(m.joinedAt).getTime();
            const left = m.leftAt ? new Date(m.leftAt).getTime() : Infinity;
            const expenseTime = dateObj.getTime();
            return expenseTime >= joined && expenseTime <= left;
          });
          
          participants = activeMembers.map(m => m.user.name);
        }

        const participantUserIds = participants.map(name => {
          const userObj = userMap[name];
          if (!userObj) {
            throw new Error(`Participant "${name}" not found in database.`);
          }
          return userObj.id;
        });

        // Insert Expense
        const expense = await tx.expense.create({
          data: {
            csvId: parseInt(row.id, 10) || null,
            groupId,
            description: row.description || `Imported Expense`,
            amount,
            currency,
            date: dateObj,
            paidById,
            splitType,
            isSettlement: false,
            status: 'APPROVED',
          },
        });

        // Calculate splits
        const numParticipants = participantUserIds.length;
        const shares = (row.sharesStr || '')
          .split('|')
          .map(s => s.trim())
          .filter(s => s !== '')
          .map(Number);

        let splitAmounts = {};

        if (splitType === 'EQUAL') {
          const equalShare = amount / numParticipants;
          participantUserIds.forEach(pId => {
            splitAmounts[pId] = { amount: equalShare, percentage: 100 / numParticipants };
          });
        } else if (splitType === 'PERCENTAGE') {
          participantUserIds.forEach((pId, idx) => {
            const pct = shares[idx] || (100 / numParticipants);
            const shareAmount = amount * (pct / 100);
            splitAmounts[pId] = { amount: shareAmount, percentage: pct };
          });
        } else if (splitType === 'EXACT') {
          participantUserIds.forEach((pId, idx) => {
            const exactVal = shares[idx] || (amount / numParticipants);
            splitAmounts[pId] = { amount: exactVal, percentage: null };
          });
        }

        // Insert splits into DB
        for (const pId of participantUserIds) {
          await tx.split.create({
            data: {
              expenseId: expense.id,
              userId: pId,
              amount: splitAmounts[pId].amount,
              percentage: splitAmounts[pId].percentage,
            },
          });
        }
        importedCount++;
      }

      // Write logs to ImportAnomaly for the Import Report (persistent history log)
      for (const log of anomaliesLog) {
        await tx.importAnomaly.create({
          data: {
            csvRow: log.csvRow,
            csvId: String(log.csvId || ''),
            date: log.date,
            description: log.description,
            amount: log.amount,
            currency: log.currency,
            paidBy: log.paidBy,
            splitType: log.splitType,
            participants: log.participants,
            shares: log.shares,
            groupName: log.groupName,
            issueType: log.issueType,
            message: log.message,
            resolvedStatus: log.resolvedStatus, // APPROVED or IGNORED
            proposedFix: log.proposedFix, // Fix applied
          },
        });
      }

      return { importedCount, skippedCount };
    });

    res.json({ success: true, message: `Successfully ingested CSV data!`, data: result });
  } catch (error) {
    console.error('Error during final ingestion:', error);
    res.status(500).json({ error: error.message || 'Failed to ingest CSV data' });
  }
});

// Start listening
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), { encoding: 'utf8' });
    console.log(`Wrote PID ${process.pid} to ${PID_FILE}`);
  } catch (err) {
    console.warn('Failed to write PID file:', err.message);
  }
});

function cleanupAndExit(code = 0) {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch (e) {}
  try { server && server.close(); } catch (e) {}
  process.exit(code);
}

process.on('SIGINT', () => { console.log('Received SIGINT, shutting down...'); cleanupAndExit(0); });
process.on('SIGTERM', () => { console.log('Received SIGTERM, shutting down...'); cleanupAndExit(0); });
process.on('exit', () => { try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch (e) {} });
