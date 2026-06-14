import fs from 'fs';

// Helper to normalize user names (trim and capitalize first letter)
export function normalizeName(name) {
  if (!name) return '';
  const clean = name.trim().toLowerCase();
  if (clean === 'aisha') return 'Aisha';
  if (clean === 'rohan') return 'Rohan';
  if (clean === 'priya') return 'Priya';
  if (clean === 'meera') return 'Meera';
  if (clean === 'sam') return 'Sam';
  if (clean === 'dev') return 'Dev';
  return name.trim(); // Return as-is if unknown, will trigger unknown user anomaly
}

// Validate date parts
export function validateDate(dateStr) {
  if (!dateStr) return { valid: false, error: 'Empty date' };
  
  // Format should be YYYY-MM-DD
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    return { valid: false, error: 'Invalid format (expected YYYY-MM-DD)' };
  }

  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  if (m < 1 || m > 12) {
    return { valid: false, error: `Invalid month: ${m}`, resolvedDate: `${y}-01-${String(d).padStart(2, '0')}` };
  }

  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) {
    return { valid: false, error: `Invalid day: ${d} for month ${m}`, resolvedDate: `${y}-${String(m).padStart(2, '0')}-${daysInMonth}` };
  }

  // Check future date
  const dateObj = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  if (dateObj > now) {
    const todayStr = now.toISOString().split('T')[0];
    return { valid: true, warning: 'Future date', dateObj, resolvedDate: todayStr };
  }

  return { valid: true, dateObj };
}

// Check membership dates
export function validateMembership(userName, dateObj) {
  const normalized = normalizeName(userName);
  const dateMs = dateObj.getTime();

  // Define memberships
  const memberships = {
    Aisha: { joined: new Date('2025-02-01T00:00:00Z'), left: null },
    Rohan: { joined: new Date('2025-02-01T00:00:00Z'), left: null },
    Priya: { joined: new Date('2025-02-01T00:00:00Z'), left: null },
    Meera: { joined: new Date('2025-02-01T00:00:00Z'), left: new Date('2025-03-31T23:59:59Z') },
    Sam: { joined: new Date('2025-04-15T00:00:00Z'), left: null },
    Dev: { joined: new Date('2025-04-01T00:00:00Z'), left: new Date('2025-04-15T23:59:59Z') },
  };

  const member = memberships[normalized];
  if (!member) {
    return { valid: false, error: 'Not a standard group member' };
  }

  if (dateMs < member.joined.getTime()) {
    return { 
      valid: false, 
      error: `${normalized} was not in group yet (joined ${member.joined.toISOString().split('T')[0]})`,
      action: 'exclude' 
    };
  }

  if (member.left && dateMs > member.left.getTime()) {
    return { 
      valid: false, 
      error: `${normalized} had left group (left ${member.left.toISOString().split('T')[0]})`,
      action: 'exclude'
    };
  }

  return { valid: true };
}

// A simple but robust CSV line parser taking quotes into account
export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Runs validation on CSV content
export function analyzeCSV(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [], anomalies: [] };

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  const anomalies = [];
  const seenRows = new Set();
  const seenIds = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const columns = parseCSVLine(line);
    
    // Check for mismatched column count
    if (columns.length < headers.length) {
      anomalies.push({
        csvRow: i + 1,
        issueType: 'COLUMN_COUNT_MISMATCH',
        message: `Row has ${columns.length} columns, expected ${headers.length}`,
        resolvedStatus: 'PENDING',
        originalRow: line,
      });
      continue;
    }

    // Map columns to fields
    const row = {
      csvRow: i + 1,
      id: columns[0],
      date: columns[1],
      description: columns[2],
      amountStr: columns[3],
      currency: columns[4],
      paidBy: columns[5],
      splitType: columns[6],
      participantsStr: columns[7],
      sharesStr: columns[8],
      groupName: columns[9],
    };

    rows.push(row);

    // --- ANOMALY CHECKS ---
    const proposedFix = { ...row };

    // 1. Check duplicate row
    const rowKey = `${row.date}|${row.description}|${row.amountStr}|${row.paidBy}|${row.participantsStr}|${row.groupName}`;
    if (seenRows.has(rowKey)) {
      anomalies.push({
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
        issueType: 'DUPLICATE_ROW',
        message: 'This row is an exact duplicate of a previous expense',
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ action: 'DELETE' }),
      });
      continue; // Skip further checks for this row since we propose deleting it
    }
    seenRows.add(rowKey);

    // 2. Check duplicate ID
    if (row.id) {
      const prevRow = seenIds.get(row.id);
      if (prevRow) {
        anomalies.push({
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
          issueType: 'DUPLICATE_ID',
          message: `ID "${row.id}" is already used by row ${prevRow.csvRow} ("${prevRow.description}")`,
          resolvedStatus: 'PENDING',
          proposedFix: JSON.stringify({ action: 'REINDEX_ID' }),
        });
      }
      seenIds.set(row.id, row);
    }

    // 3. Name Casing & Trailing Spaces in Payer
    const rawPayer = row.paidBy || '';
    const cleanPayer = normalizeName(rawPayer);
    if (rawPayer !== cleanPayer && rawPayer.trim() !== '') {
      proposedFix.paidBy = cleanPayer;
      anomalies.push({
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
        issueType: 'NAME_FORMAT_NORMALIZATION',
        message: `Payer name "${rawPayer}" has formatting or case issues, normalized to "${cleanPayer}"`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, paidBy: cleanPayer }),
      });
    }

    // 4. Missing/Empty Payer
    if (!rawPayer.trim()) {
      anomalies.push({
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
        issueType: 'MISSING_PAYER',
        message: 'The payer field is empty',
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, paidBy: 'Aisha' }), // Default to Aisha or require manual input
      });
    } else {
      // 5. Unknown Payer (not a valid flatmate)
      const validNames = ['Aisha', 'Rohan', 'Priya', 'Meera', 'Sam', 'Dev'];
      if (!validNames.includes(cleanPayer)) {
        anomalies.push({
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
          issueType: 'UNKNOWN_PAYER',
          message: `Payer "${rawPayer}" is not a recognized group member`,
          resolvedStatus: 'PENDING',
          proposedFix: JSON.stringify({ ...proposedFix, paidBy: 'Rohan' }), // Let user remap
        });
      }
    }

    // 6. Validate Date
    const dateVal = validateDate(row.date);
    if (!dateVal.valid) {
      proposedFix.date = dateVal.resolvedDate || row.date;
      anomalies.push({
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
        issueType: 'INVALID_DATE',
        message: `Date is invalid: ${dateVal.error}`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, date: dateVal.resolvedDate }),
      });
    } else if (dateVal.warning) {
      proposedFix.date = dateVal.resolvedDate;
      anomalies.push({
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
        issueType: 'FUTURE_DATE',
        message: `Expense date "${row.date}" is in the future. Resetting to current date.`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, date: dateVal.resolvedDate }),
      });
    }

    // 7. Validate Amount
    const amountVal = parseFloat(row.amountStr);
    if (isNaN(amountVal)) {
      anomalies.push({
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
        issueType: 'INVALID_AMOUNT',
        message: `Amount "${row.amountStr}" is not a valid number`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, amountStr: '0' }),
      });
    } else if (amountVal < 0) {
      // Negative amount: refund
      anomalies.push({
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
        issueType: 'NEGATIVE_AMOUNT',
        message: `Amount is negative (${amountVal}). Handled as a REFUND.`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, amountStr: String(Math.abs(amountVal)), isRefund: true }),
      });
    } else if (amountVal === 0) {
      anomalies.push({
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
        issueType: 'ZERO_AMOUNT',
        message: 'Amount is 0. Logged as zero-cost or skipped.',
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, action: 'SKIP' }),
      });
    }

    // 8. Foreign or Unknown Currency
    const rawCurrency = (row.currency || '').trim().toUpperCase();
    if (rawCurrency !== 'INR' && rawCurrency !== 'USD') {
      const isKnownForeign = (rawCurrency === 'EUR');
      anomalies.push({
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
        issueType: isKnownForeign ? 'FOREIGN_CURRENCY' : 'UNKNOWN_CURRENCY',
        message: `Currency "${rawCurrency}" is not standard (INR/USD). Will need conversion.`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, currency: rawCurrency, baseCurrency: 'INR' }),
      });
    }

    // 9. Settlement Logged as Expense
    const descLower = (row.description || '').toLowerCase();
    if (descLower.includes('settlement') || descLower.includes('transfer to')) {
      anomalies.push({
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
        issueType: 'SETTLEMENT_LOGGED_AS_EXPENSE',
        message: `Description "${row.description}" indicates this is a settlement/transfer rather than a shared expense`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, isSettlement: true }),
      });
    }

    // 10. Split Type Validation
    const cleanSplitType = (row.splitType || '').trim().toUpperCase();
    if (!['EQUAL', 'PERCENTAGE', 'EXACT'].includes(cleanSplitType)) {
      anomalies.push({
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
        issueType: 'INVALID_SPLIT_TYPE',
        message: `Split type "${row.splitType}" is invalid. Defaulting to EQUAL.`,
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, splitType: 'EQUAL' }),
      });
    }

    // 11. Participants validation
    const participants = (row.participantsStr || '')
      .split('|')
      .map(p => p.trim())
      .filter(p => p !== '')
      .map(normalizeName);

    if (participants.length === 0) {
      anomalies.push({
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
        issueType: 'EMPTY_PARTICIPANTS',
        message: 'No participants listed for the expense split',
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, participantsStr: 'AUTO_ALL' }),
      });
    } else if (participants.length === 1 && participants[0] === cleanPayer) {
      anomalies.push({
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
        issueType: 'SINGLE_PARTICIPANT_SELF',
        message: 'Expense has only one participant who is also the payer (personal expense)',
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, action: 'SKIP' }),
      });
    }

    // 12. Membership constraints on Date
    if (dateVal.valid && dateVal.dateObj) {
      const expenseDate = dateVal.dateObj;

      // Check payer membership validity
      if (cleanPayer) {
        const payerMem = validateMembership(cleanPayer, expenseDate);
        if (!payerMem.valid) {
          anomalies.push({
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
            issueType: 'PAYER_OUT_OF_BOUNDS_MEMBERSHIP',
            message: `Payer check: ${payerMem.error}`,
            resolvedStatus: 'PENDING',
            proposedFix: JSON.stringify({ ...proposedFix, paidBy: 'Aisha' }), // Map to Aisha or require change
          });
        }
      }

      // Check participants membership validity
      const invalidParticipants = [];
      for (const p of participants) {
        const pMem = validateMembership(p, expenseDate);
        if (!pMem.valid) {
          invalidParticipants.push({ name: p, error: pMem.error });
        }
      }

      if (invalidParticipants.length > 0) {
        const fixedParticipants = participants.filter(p => !invalidParticipants.some(ip => ip.name === p));
        proposedFix.participantsStr = fixedParticipants.join('|');
        anomalies.push({
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
          issueType: 'PARTICIPANT_OUT_OF_BOUNDS_MEMBERSHIP',
          message: `Participants out of bounds: ${invalidParticipants.map(ip => ip.error).join('; ')}`,
          resolvedStatus: 'PENDING',
          proposedFix: JSON.stringify({ ...proposedFix, participantsStr: fixedParticipants.join('|') }),
        });
      }
    }

    // 13. Shares vs Split Type Validation
    if (participants.length > 0 && !isNaN(amountVal)) {
      const shares = (row.sharesStr || '')
        .split('|')
        .map(s => s.trim())
        .filter(s => s !== '')
        .map(Number);

      if (cleanSplitType === 'PERCENTAGE') {
        if (shares.length !== participants.length) {
          anomalies.push({
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
            issueType: 'PERCENTAGE_SHARE_COUNT_MISMATCH',
            message: `Has ${shares.length} shares for ${participants.length} participants`,
            resolvedStatus: 'PENDING',
            proposedFix: JSON.stringify({ ...proposedFix, sharesStr: participants.map(() => Math.round(100 / participants.length)).join('|') }),
          });
        } else {
          const sum = shares.reduce((acc, curr) => acc + curr, 0);
          if (Math.abs(sum - 100) > 0.01) {
            // Percentages don't sum to 100
            const scaleFactor = 100 / sum;
            const scaledShares = shares.map(s => Math.round(s * scaleFactor));
            // Adjust rounding to hit exactly 100
            const scaledSum = scaledShares.reduce((acc, curr) => acc + curr, 0);
            if (scaledSum !== 100) scaledShares[0] += (100 - scaledSum);

            anomalies.push({
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
              issueType: sum < 100 ? 'PERCENTAGE_UNDER_100' : 'PERCENTAGE_OVER_100',
              message: `Percentage shares sum to ${sum}%, expected 100%`,
              resolvedStatus: 'PENDING',
              proposedFix: JSON.stringify({ ...proposedFix, sharesStr: scaledShares.join('|') }),
            });
          }
        }
      } else if (cleanSplitType === 'EXACT') {
        if (shares.length !== participants.length) {
          anomalies.push({
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
            issueType: 'EXACT_SHARE_COUNT_MISMATCH',
            message: `Has ${shares.length} exact shares for ${participants.length} participants`,
            resolvedStatus: 'PENDING',
            proposedFix: JSON.stringify({ ...proposedFix, sharesStr: participants.map(() => amountVal / participants.length).join('|') }),
          });
        } else {
          const sum = shares.reduce((acc, curr) => acc + curr, 0);
          if (Math.abs(sum - amountVal) > 0.05) {
            // Sum of shares doesn't match total amount
            anomalies.push({
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
              issueType: 'EXACT_SPLIT_SUM_MISMATCH',
              message: `Exact shares sum to ${sum}, but expense amount is ${amountVal}`,
              resolvedStatus: 'PENDING',
              proposedFix: JSON.stringify({ ...proposedFix, sharesStr: shares.map(s => (s * amountVal / sum).toFixed(2)).join('|') }),
            });
          }
        }
      }
    }

    // 14. Missing Description
    if (!(row.description || '').trim()) {
      anomalies.push({
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
        issueType: 'MISSING_DESCRIPTION',
        message: 'The description field is empty',
        resolvedStatus: 'PENDING',
        proposedFix: JSON.stringify({ ...proposedFix, description: `Expense Row ${row.csvRow}` }),
      });
    }
  }

  return { headers, rows, anomalies };
}
