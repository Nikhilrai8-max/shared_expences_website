export const EXCHANGE_RATES = {
  INR: 1.0,
  USD: 83.0,
  EUR: 90.0,
};

export function getExchangeRate(currency) {
  const curr = (currency || '').trim().toUpperCase();
  return EXCHANGE_RATES[curr] || 1.0;
}

// Net balance matching debt-minimization algorithm
export function minimizeDebts(balances) {
  // balances is an array of { userId, userName, balance }
  // Filter out people with near-zero balance
  const debtors = [];
  const creditors = [];

  for (const b of balances) {
    const bal = Math.round(b.balance * 100) / 100; // Round to 2 decimal places
    if (bal < -0.05) {
      debtors.push({ ...b, balance: bal });
    } else if (bal > 0.05) {
      creditors.push({ ...b, balance: bal });
    }
  }

  // Sort debtors ascending (most negative first)
  // Sort creditors descending (most positive first)
  debtors.sort((a, b) => a.balance - b.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  const transactions = [];

  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];

    const amountToSettle = Math.min(-debtor.balance, creditor.balance);
    const roundedAmount = Math.round(amountToSettle * 100) / 100;

    if (roundedAmount > 0) {
      transactions.push({
        fromId: debtor.userId,
        fromName: debtor.userName,
        toId: creditor.userId,
        toName: creditor.userName,
        amount: roundedAmount,
      });
    }

    debtor.balance += roundedAmount;
    creditor.balance -= roundedAmount;

    if (Math.abs(debtor.balance) < 0.05) {
      d++;
    }
    if (Math.abs(creditor.balance) < 0.05) {
      c++;
    }
  }

  return transactions;
}

// Calculate net balances for a group
export async function calculateBalances(groupId, prisma) {
  const users = await prisma.user.findMany({
    include: {
      memberships: {
        where: { groupId },
      },
    },
  });

  // Filter users who have ever been members of this group
  const groupMembers = users.filter(u => u.memberships.length > 0);

  // Initialize summary for each member
  const balancesMap = {};
  for (const member of groupMembers) {
    balancesMap[member.id] = {
      userId: member.id,
      userName: member.name,
      paid: 0,
      owed: 0,
      settlementsSent: 0,
      settlementsReceived: 0,
      balance: 0,
    };
  }

  // Get all approved expenses in the group (excluding settlements logged as expenses)
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      status: 'APPROVED',
      isSettlement: false,
    },
    include: {
      splits: true,
    },
  });

  // Accumulate expense splits
  for (const exp of expenses) {
    const rate = getExchangeRate(exp.currency);
    const totalInINR = exp.amount * rate;

    // Add paid amount in INR to the payer
    if (balancesMap[exp.paidById]) {
      balancesMap[exp.paidById].paid += totalInINR;
    }

    // Add owed shares in INR to each participant
    for (const split of exp.splits) {
      if (balancesMap[split.userId]) {
        balancesMap[split.userId].owed += split.amount * rate;
      }
    }
  }

  // Get all approved settlements in the group
  const settlements = await prisma.settlement.findMany({
    where: {
      groupId,
      isApproved: true,
    },
  });

  // Accumulate settlements
  for (const set of settlements) {
    const rate = getExchangeRate(set.currency);
    const amountInINR = set.amount * rate;

    if (balancesMap[set.fromUserId]) {
      balancesMap[set.fromUserId].settlementsSent += amountInINR;
    }
    if (balancesMap[set.toUserId]) {
      balancesMap[set.toUserId].settlementsReceived += amountInINR;
    }
  }

  // Calculate final net balance in INR:
  // (Paid - Owed) + (Settlements Sent - Settlements Received)
  const balancesList = Object.values(balancesMap).map(b => {
    b.balance = (b.paid - b.owed) + (b.settlementsSent - b.settlementsReceived);
    // Round fields to 2 decimals
    b.paid = Math.round(b.paid * 100) / 100;
    b.owed = Math.round(b.owed * 100) / 100;
    b.settlementsSent = Math.round(b.settlementsSent * 100) / 100;
    b.settlementsReceived = Math.round(b.settlementsReceived * 100) / 100;
    b.balance = Math.round(b.balance * 100) / 100;
    return b;
  });

  // Calculate peer-to-peer simplified debts
  const simplifiedDebts = minimizeDebts(balancesList);

  return {
    balances: balancesList,
    simplifiedDebts,
  };
}

// Generate the Ledger Audit Trail for a specific user
export async function getLedger(groupId, userId, prisma) {
  // Find the user and verify they exist
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) throw new Error('User not found');

  // Fetch all approved, non-settlement expenses in this group that the user is either:
  // - Payer
  // - Participant (present in splits)
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      status: 'APPROVED',
      isSettlement: false,
      OR: [
        { paidById: userId },
        { splits: { some: { userId } } },
      ],
    },
    include: {
      paidBy: true,
      splits: {
        include: {
          user: true,
        },
      },
    },
    orderBy: {
      date: 'asc',
    },
  });

  // Fetch all approved settlements where user is sender or receiver
  const settlements = await prisma.settlement.findMany({
    where: {
      groupId,
      isApproved: true,
      OR: [
        { fromUserId: userId },
        { toUserId: userId },
      ],
    },
    include: {
      fromUser: true,
      toUser: true,
    },
    orderBy: {
      date: 'asc',
    },
  });

  // Combine expenses and settlements into a single chronological ledger
  const ledgerItems = [];

  for (const exp of expenses) {
    const rate = getExchangeRate(exp.currency);
    const amountInINR = exp.amount * rate;

    const userSplit = exp.splits.find(s => s.userId === userId);
    const userOwedInINR = userSplit ? userSplit.amount * rate : 0;
    const userPaidInINR = exp.paidById === userId ? amountInINR : 0;
    const netImpact = userPaidInINR - userOwedInINR;

    // Create participant text description
    const participantsList = exp.splits.map(s => s.user.name).join(', ');

    ledgerItems.push({
      id: `expense-${exp.id}`,
      type: 'EXPENSE',
      date: exp.date,
      description: exp.description,
      originalAmount: exp.amount,
      originalCurrency: exp.currency,
      exchangeRate: rate,
      amountInINR,
      paidBy: exp.paidBy.name,
      splitType: exp.splitType,
      userShareAmount: userSplit ? userSplit.amount : 0,
      userOwedInINR,
      userPaidInINR,
      netImpact,
      details: `Paid by ${exp.paidBy.name}. Participants: [${participantsList}]. Split Type: ${exp.splitType}.`,
    });
  }

  for (const set of settlements) {
    const rate = getExchangeRate(set.currency);
    const amountInINR = set.amount * rate;

    let netImpact = 0;
    let details = '';

    if (set.fromUserId === userId) {
      // Sent settlement: user paid out money to resolve debt (net balance increases)
      netImpact = amountInINR;
      details = `Settlement sent to ${set.toUser.name}`;
    } else {
      // Received settlement: user received money (net balance decreases)
      netImpact = -amountInINR;
      details = `Settlement received from ${set.fromUser.name}`;
    }

    ledgerItems.push({
      id: `settlement-${set.id}`,
      type: 'SETTLEMENT',
      date: set.date,
      description: `Settlement: ${set.fromUser.name} → ${set.toUser.name}`,
      originalAmount: set.amount,
      originalCurrency: set.currency,
      exchangeRate: rate,
      amountInINR,
      paidBy: set.fromUser.name,
      splitType: 'N/A',
      userShareAmount: 0,
      userOwedInINR: 0,
      userPaidInINR: set.fromUserId === userId ? amountInINR : 0,
      netImpact,
      details,
    });
  }

  // Sort chronologically
  ledgerItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Compute running balance
  let runningBalance = 0;
  const auditTrail = ledgerItems.map(item => {
    runningBalance += item.netImpact;
    return {
      ...item,
      runningBalance: Math.round(runningBalance * 100) / 100,
      netImpact: Math.round(item.netImpact * 100) / 100,
    };
  });

  return auditTrail;
}
