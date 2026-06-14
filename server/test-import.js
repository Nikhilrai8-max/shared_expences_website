import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { analyzeCSV, normalizeName } from './services/importer.js';
import { calculateBalances } from './services/calculations.js';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTest() {
  console.log('=== RUNNING AUTOMATED IMPORT TEST ===');
  
  // 1. Read CSV File
  const csvPath = path.resolve(__dirname, '..', 'shared_expenses_extended.csv');
  console.log(`Reading CSV from: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  // 2. Run Analysis
  console.log('Analyzing CSV for anomalies...');
  const analysis = analyzeCSV(csvContent);
  console.log(`Successfully parsed ${analysis.rows.length} rows.`);
  console.log(`Detected ${analysis.anomalies.length} data anomalies.\n`);

  // Print all anomalies
  console.log('--- DETECTED ANOMALIES ---');
  analysis.anomalies.forEach(a => {
    console.log(`[Row ${a.csvRow}] ${a.issueType}: ${a.message}`);
    console.log(`  Original: ID=${a.csvId}, Date=${a.date}, Amount=${a.amount}, Payer=${a.paidBy}, Parts=${a.participants}`);
    console.log(`  Proposed Fix: ${a.proposedFix}\n`);
  });

  // 3. Resolve all anomalies with default proposed actions
  console.log('Simulating User Ingestion: Resolving all anomalies via default "Approve"...');
  
  const finalizedRows = [];
  const anomaliesLog = [];

  const dbUsers = await prisma.user.findMany();
  const dbGroups = await prisma.group.findMany();

  const userMap = {};
  dbUsers.forEach(u => { userMap[u.name] = u; });

  const groupMap = {};
  dbGroups.forEach(g => { groupMap[g.name] = g; });

  // Map row numbers to resolutions
  const resolutionsMap = {};
  analysis.anomalies.forEach(anomaly => {
    const proposed = JSON.parse(anomaly.proposedFix || '{}');
    resolutionsMap[anomaly.csvRow] = {
      action: proposed.action === 'DELETE' ? 'DELETE' : 'APPROVE',
      proposedFix: proposed,
      issueType: anomaly.issueType,
      message: anomaly.message,
    };
  });

  for (const row of analysis.rows) {
    const res = resolutionsMap[row.csvRow];
    if (res) {
      // Log anomaly
      anomaliesLog.push({
        csvRow: row.csvRow,
        csvId: row.id,
        date: row.date,
        description: row.description,
        amount: row.amountStr,
        currency: row.currency,
        paidBy: row.paidBy,
        splitType: row.splitType,
        participants: row.participantsStr,
        shares: row.sharesStr,
        groupName: row.groupName,
        issueType: res.issueType,
        message: res.message,
        resolvedStatus: 'APPROVED',
        proposedFix: JSON.stringify(res.proposedFix),
      });

      if (res.action === 'DELETE' || res.action === 'SKIP' || res.proposedFix.action === 'SKIP') {
        continue; // Skip row
      }

      // Merge proposed fix
      finalizedRows.push({
        ...row,
        ...res.proposedFix,
      });
    } else {
      // Clean row
      finalizedRows.push(row);
    }
  }

  // 4. Ingest into Database in batches without a single long-running transaction
  console.log(`Ingesting ${finalizedRows.length} resolved rows into DB...`);

  await prisma.split.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.settlement.deleteMany({});
  await prisma.importAnomaly.deleteMany({});

  for (const row of finalizedRows) {
    if (row.action === 'SKIP' || row.action === 'DELETE') continue;

    const rawGroup = row.groupName || 'Flat';
    const groupObj = groupMap[rawGroup];
    if (!groupObj) throw new Error(`Group ${rawGroup} not found`);
    const groupId = groupObj.id;

    const dateObj = new Date(row.date);
    const payerName = normalizeName(row.paidBy);
    const payerObj = userMap[payerName];
    if (!payerObj) throw new Error(`User ${row.paidBy} not found`);
    const paidById = payerObj.id;

    const amount = parseFloat(row.amountStr || row.amount);
    const currency = (row.currency || 'INR').trim().toUpperCase();

    if (row.isSettlement === true) {
      let toUserName = '';
      const desc = (row.description || '').toLowerCase();
      if (desc.includes('to aisha') || row.participantsStr === 'Aisha') toUserName = 'Aisha';
      else if (desc.includes('to priya') || row.participantsStr === 'Priya') toUserName = 'Priya';
      else if (desc.includes('to meera') || row.participantsStr === 'Meera') toUserName = 'Meera';
      else if (desc.includes('to rohan') || row.participantsStr === 'Rohan') toUserName = 'Rohan';
      else {
        const parts = (row.participantsStr || '').split('|').map(p => normalizeName(p.trim()));
        toUserName = parts[0] || 'Aisha';
      }

      const toUserObj = userMap[toUserName];
      if (!toUserObj) {
        console.warn(`Skipping settlement row ${row.csvRow}: unknown target ${toUserName}`);
        continue;
      }

      await prisma.settlement.create({
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
      continue;
    }

    const splitType = (row.splitType || 'EQUAL').trim().toUpperCase();
    let participants = (row.participantsStr || '')
      .split('|')
      .map(p => p.trim())
      .filter(p => p !== '')
      .map(normalizeName);

    if (row.participantsStr === 'AUTO_ALL' || participants.length === 0) {
      const memberships = await prisma.membership.findMany({
        where: { groupId },
        include: { user: true },
      });
      const active = memberships.filter(m => {
        const joined = new Date(m.joinedAt).getTime();
        const left = m.leftAt ? new Date(m.leftAt).getTime() : Infinity;
        const t = dateObj.getTime();
        return t >= joined && t <= left;
      });
      participants = active.map(m => m.user.name);
    }

    const participantUserIds = participants
      .map(n => userMap[n])
      .filter(Boolean)
      .map(u => u.id);

    if (participantUserIds.length === 0) {
      console.warn(`Skipping row ${row.csvRow}: no valid participants found`);
      continue;
    }

    const exp = await prisma.expense.create({
      data: {
        csvId: Number.isFinite(Number(row.id)) ? Number(row.id) : null,
        groupId,
        description: row.description || 'Imported',
        amount,
        currency,
        date: dateObj,
        paidById,
        splitType,
        isSettlement: false,
        status: 'APPROVED',
      },
    });

    const shares = (row.sharesStr || '')
      .split('|')
      .map(s => s.trim())
      .filter(s => s !== '')
      .map(Number);

    const splitRecords = [];
    if (splitType === 'PERCENTAGE') {
      participantUserIds.forEach((userId, idx) => {
        const pct = shares[idx] || 100 / participantUserIds.length;
        splitRecords.push({
          expenseId: exp.id,
          userId,
          amount: parseFloat((amount * (pct / 100)).toFixed(2)),
          percentage: pct,
        });
      });
    } else if (splitType === 'EXACT') {
      participantUserIds.forEach((userId, idx) => {
        splitRecords.push({
          expenseId: exp.id,
          userId,
          amount: shares[idx] || parseFloat((amount / participantUserIds.length).toFixed(2)),
          percentage: null,
        });
      });
    } else {
      const equalAmount = parseFloat((amount / participantUserIds.length).toFixed(2));
      const percentage = parseFloat((100 / participantUserIds.length).toFixed(2));
      participantUserIds.forEach((userId) => {
        splitRecords.push({
          expenseId: exp.id,
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

  for (const log of anomaliesLog) {
    await prisma.importAnomaly.create({ data: log });
  }

  console.log('Database import completed successfully!');

  // 5. Calculate and Display Balances for "Flat" group
  console.log('\n======================================');
  console.log('=== BALANCES SUMMARY: GROUP [FLAT] ===');
  console.log('======================================');
  
  const flatGroup = groupMap['Flat'];
  const flatBalances = await calculateBalances(flatGroup.id, prisma);
  
  console.table(flatBalances.balances.map(b => ({
    Member: b.userName,
    'Paid (INR)': b.paid.toFixed(2),
    'Owed (INR)': b.owed.toFixed(2),
    'Settlements Sent': b.settlementsSent.toFixed(2),
    'Settlements Recv': b.settlementsReceived.toFixed(2),
    'Net Balance (INR)': b.balance.toFixed(2),
  })));

  console.log('\n--- SIMPLIFIED DEBTS: WHO PAYS WHOM ---');
  flatBalances.simplifiedDebts.forEach(d => {
    console.log(`>>> ${d.fromName} pays ${d.toName}: Rs. ${d.amount.toFixed(2)}`);
  });

  // 6. Calculate and Display Balances for "Trip" group
  console.log('\n======================================');
  console.log('=== BALANCES SUMMARY: GROUP [TRIP] ===');
  console.log('======================================');
  
  const tripGroup = groupMap['Trip'];
  const tripBalances = await calculateBalances(tripGroup.id, prisma);
  
  console.table(tripBalances.balances.map(b => ({
    Member: b.userName,
    'Paid (INR)': b.paid.toFixed(2),
    'Owed (INR)': b.owed.toFixed(2),
    'Settlements Sent': b.settlementsSent.toFixed(2),
    'Settlements Recv': b.settlementsReceived.toFixed(2),
    'Net Balance (INR)': b.balance.toFixed(2),
  })));

  console.log('\n--- SIMPLIFIED DEBTS: WHO PAYS WHOM ---');
  tripBalances.simplifiedDebts.forEach(d => {
    console.log(`>>> ${d.fromName} pays ${d.toName}: Rs. ${d.amount.toFixed(2)}`);
  });

  console.log('\n=== END OF IMPORT AND CALCULATION TEST ===');
}

runTest()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
