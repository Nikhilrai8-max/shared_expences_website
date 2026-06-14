import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { analyzeCSV, normalizeName } from '../services/importer.js';
import { calculateBalances } from '../services/calculations.js';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.resolve(__dirname, '..', '..', 'shared_expenses_extended.csv');

async function seedBaseData() {
  console.log('Seeding database...');

  await prisma.importAnomaly.deleteMany();
  await prisma.split.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  const users = {};
  const userNames = ['Aisha', 'Rohan', 'Priya', 'Meera', 'Sam', 'Dev'];
  for (const name of userNames) {
    users[name] = await prisma.user.create({
      data: {
        name,
        email: `${name.toLowerCase()}@flatmates.com`,
      },
    });
  }
  console.log(`Created ${Object.keys(users).length} users.`);

  const groupFlat = await prisma.group.create({
    data: {
      name: 'Flat',
      description: 'Shared flat household expenses',
    },
  });

  const groupTrip = await prisma.group.create({
    data: {
      name: 'Trip',
      description: 'Holiday spending in US Dollars and other currencies',
    },
  });
  console.log('Created groups: Flat, Trip');

  const startOfFeb = new Date('2025-02-01T00:00:00Z');
  const endOfMarch = new Date('2025-03-31T23:59:59Z');
  const startOfApril = new Date('2025-04-01T00:00:00Z');
  const midApril = new Date('2025-04-15T00:00:00Z');
  const midAprilTripEnd = new Date('2025-04-15T23:59:59Z');

  const memberships = [
    { group: groupFlat, user: users.Aisha, joined: startOfFeb, left: null },
    { group: groupFlat, user: users.Rohan, joined: startOfFeb, left: null },
    { group: groupFlat, user: users.Priya, joined: startOfFeb, left: null },
    { group: groupFlat, user: users.Meera, joined: startOfFeb, left: endOfMarch },
    { group: groupFlat, user: users.Sam, joined: midApril, left: null },
    { group: groupTrip, user: users.Aisha, joined: startOfApril, left: null },
    { group: groupTrip, user: users.Rohan, joined: startOfApril, left: null },
    { group: groupTrip, user: users.Priya, joined: startOfApril, left: null },
    { group: groupTrip, user: users.Dev, joined: startOfApril, left: midAprilTripEnd },
  ];

  for (const m of memberships) {
    await prisma.membership.create({
      data: {
        groupId: m.group.id,
        userId: m.user.id,
        joinedAt: m.joined,
        leftAt: m.left,
      },
    });
  }

  console.log('Successfully seeded database with users, groups, and memberships!');

  return {
    users,
    groups: {
      Flat: groupFlat,
      Trip: groupTrip,
    },
  };
}

function parseShareValues(sharesStr, count) {
  const values = (sharesStr || '')
    .split('|')
    .map(v => v.trim())
    .filter(v => v !== '')
    .map(Number)
    .map(v => (Number.isFinite(v) ? v : 0));

  if (values.length === count) {
    return values;
  }

  return Array(count).fill(0);
}

function parseParticipants(participantsStr) {
  return (participantsStr || '')
    .split('|')
    .map(p => normalizeName(p.trim()))
    .filter(p => p);
}

function getResolvedRow(row, anomalies) {
  const result = { ...row };
  const fixes = {};

  for (const anomaly of anomalies || []) {
    try {
      Object.assign(fixes, JSON.parse(anomaly.proposedFix || '{}'));
    } catch {
      // ignore invalid proposedFix payloads
    }
  }

  return { ...result, ...fixes };
}

function shouldSkipRow(row, anomalies) {
  for (const anomaly of anomalies || []) {
    try {
      const proposed = JSON.parse(anomaly.proposedFix || '{}');
      if (proposed.action === 'DELETE' || proposed.action === 'SKIP') {
        return true;
      }
    } catch {
      // ignore parse errors
    }
  }

  return false;
}

async function importCsvData(users, groups) {
  if (!fs.existsSync(csvPath)) {
    console.warn(`CSV file not found at ${csvPath}. Skipping expense import.`);
    return;
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const analysis = analyzeCSV(csvContent);
  console.log(`Parsed ${analysis.rows.length} CSV rows with ${analysis.anomalies.length} anomalies.`);

  const anomalyMap = new Map();
  for (const anomaly of analysis.anomalies) {
    if (!anomalyMap.has(anomaly.csvRow)) {
      anomalyMap.set(anomaly.csvRow, []);
    }
    anomalyMap.get(anomaly.csvRow).push(anomaly);
  }

  const resolvedRows = [];
  for (const row of analysis.rows) {
    const rowAnomalies = anomalyMap.get(row.csvRow) || [];
    if (shouldSkipRow(row, rowAnomalies)) continue;
    resolvedRows.push(getResolvedRow(row, rowAnomalies));
  }

  const groupMap = groups;
  const userMap = users;
  const memberships = await prisma.membership.findMany({
    include: { user: true },
    where: { groupId: { in: Object.values(groupMap).map(g => g.id) } },
  });

  for (const row of analysis.anomalies) {
    await prisma.importAnomaly.create({
      data: {
        csvRow: row.csvRow,
        csvId: row.csvId,
        date: row.date,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        paidBy: row.paidBy,
        splitType: row.splitType,
        participants: row.participantsStr,
        shares: row.sharesStr,
        groupName: row.groupName,
        issueType: row.issueType,
        message: row.message,
        resolvedStatus: 'APPROVED',
        proposedFix: row.proposedFix || null,
      },
    });
  }

  for (const row of resolvedRows) {
    const finalRow = row;
    const groupName = String(finalRow.groupName || 'Flat').trim() || 'Flat';
    const group = groupMap[groupName] || groupMap.Flat;
    const dateObj = new Date(finalRow.date);
    if (Number.isNaN(dateObj.getTime())) {
      console.warn(`Skipping row ${finalRow.csvRow}: invalid date ${finalRow.date}`);
      continue;
    }

    const payerName = normalizeName(String(finalRow.paidBy || 'Aisha'));
    const payer = userMap[payerName];
    if (!payer) {
      console.warn(`Skipping row ${finalRow.csvRow}: unknown payer ${finalRow.paidBy}`);
      continue;
    }

    const paidById = payer.id;
    const amount = parseFloat(String(finalRow.amount || finalRow.amountStr || '0')) || 0;
    const currency = String(finalRow.currency || 'INR').trim().toUpperCase();
    const splitType = String(finalRow.splitType || 'EQUAL').trim().toUpperCase();
    const isSettlement = finalRow.isSettlement === true;

    if (isSettlement) {
      const settlementParticipants = parseParticipants(finalRow.participantsStr);
      const targetName = settlementParticipants[0] || normalizeName(finalRow.paidBy || 'Aisha');
      const target = userMap[targetName] || payer;

      await prisma.settlement.create({
        data: {
          groupId: group.id,
          fromUserId: paidById,
          toUserId: target.id,
          amount,
          currency,
          date: dateObj,
          isApproved: true,
        },
      });
      continue;
    }

    let participantNames = parseParticipants(finalRow.participantsStr);
    if (finalRow.participantsStr === 'AUTO_ALL' || participantNames.length === 0) {
      participantNames = memberships
        .filter(m => m.groupId === group.id)
        .filter(m => {
          const joined = new Date(m.joinedAt).getTime();
          const left = m.leftAt ? new Date(m.leftAt).getTime() : Infinity;
          const time = dateObj.getTime();
          return time >= joined && time <= left;
        })
        .map(m => m.user.name);
    }

    const participantUsers = participantNames
      .map(name => userMap[normalizeName(name)])
      .filter(Boolean);

    if (participantUsers.length === 0) {
      console.warn(`Skipping row ${finalRow.csvRow}: no valid participants`);
      continue;
    }

    const expense = await prisma.expense.create({
      data: {
        csvId: Number.isFinite(Number(finalRow.id)) ? Number(finalRow.id) : null,
        groupId: group.id,
        description: String(finalRow.description || 'Imported expense'),
        amount,
        currency,
        date: dateObj,
        paidById,
        splitType,
        isSettlement: false,
        status: 'APPROVED',
      },
    });

    const participantIds = participantUsers.map(u => u.id);
    const shares = parseShareValues(finalRow.sharesStr, participantIds.length);
    const splitRecords = [];

    if (splitType === 'PERCENTAGE') {
      participantIds.forEach((userId, idx) => {
        const pct = shares[idx] || 100 / participantIds.length;
        splitRecords.push({
          expenseId: expense.id,
          userId,
          amount: parseFloat((amount * (pct / 100)).toFixed(2)),
          percentage: pct,
        });
      });
    } else if (splitType === 'EXACT') {
      participantIds.forEach((userId, idx) => {
        splitRecords.push({
          expenseId: expense.id,
          userId,
          amount: shares[idx] || parseFloat((amount / participantIds.length).toFixed(2)),
          percentage: null,
        });
      });
    } else {
      const equalAmount = parseFloat((amount / participantIds.length).toFixed(2));
      const percentage = parseFloat((100 / participantIds.length).toFixed(2));
      participantIds.forEach((userId) => {
        splitRecords.push({
          expenseId: expense.id,
          userId,
          amount: equalAmount,
          percentage,
        });
      });
    }

    for (const split of splitRecords) {
      await prisma.split.create({ data: split });
    }
  }

  const flatGroup = groups.Flat;
  const balances = await calculateBalances(flatGroup.id, prisma);
  console.log('Imported CSV data. Sample balances for Flat group:');
  console.table(balances.balances.map(b => ({
    Member: b.userName,
    Paid: b.paid,
    Owed: b.owed,
    Balance: b.balance,
  })));
}

async function main() {
  try {
    const seeded = await seedBaseData();
    await importCsvData(seeded.users, seeded.groups);
    console.log('CSV import seed complete.');
  } catch (error) {
    console.error('Seeder failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
