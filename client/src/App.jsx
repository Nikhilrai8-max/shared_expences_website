import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function App() {
  // --- STATE ---
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, ledger, import, report
  
  // Dashboard & Balance States
  const [balances, setBalances] = useState([]);
  const [debts, setDebts] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [ledgerItems, setLedgerItems] = useState([]);
  
  // Import States
  const [csvFile, setCsvFile] = useState(null);
  const [importStatus, setImportStatus] = useState('idle'); // idle, analyzing, staging, finalising, success, error
  const [csvData, setCsvData] = useState(null); // { headers, rows, anomalies }
  const [resolutions, setResolutions] = useState({}); // rowNumber -> { action, resolvedRow }
  const [importReport, setImportReport] = useState([]);
  
  // Modal States for Manual Actions
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [loginUserId, setLoginUserId] = useState('');
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  
  // Group creation Form State
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');

  // User registration Form State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');

  // Add Member Form State
  const [addMemberUserId, setAddMemberUserId] = useState('');
  const [addMemberJoinDate, setAddMemberJoinDate] = useState(new Date().toISOString().split('T')[0]);

  // Leave Member Form State
  const [leaveMemberUserId, setLeaveMemberUserId] = useState(null);
  const [leaveMemberUserName, setLeaveMemberUserName] = useState('');
  const [leaveMemberDate, setLeaveMemberDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Manual Expense Form State
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCurrency, setExpCurrency] = useState('INR');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expPaidBy, setExpPaidBy] = useState('');
  const [expSplitType, setExpSplitType] = useState('EQUAL');
  const [expParticipants, setExpParticipants] = useState({}); // userId -> boolean
  const [expShares, setExpShares] = useState({}); // userId -> number/string

  // Manual Settlement Form State
  const [setFrom, setSetFrom] = useState('');
  const [setTo, setSetTo] = useState('');
  const [setAmount, setSetAmount] = useState('');
  const [setCurrency, setSetCurrency] = useState('INR');
  const [setDateVal, setSetDateVal] = useState(new Date().toISOString().split('T')[0]);
  
  // Modify Anomaly Inline Form State
  const [editingRow, setEditingRow] = useState(null); // rowNumber
  const [editFormData, setEditFormData] = useState({});

  // --- INITIAL LOAD ---
  useEffect(() => {
    fetchUsers();
    fetchGroups();
    fetchImportReport();
  }, []);

  // Sync balances and ledger when active group or current user changes
  useEffect(() => {
    if (activeGroup) {
      fetchBalances(activeGroup.id);
      fetchGroupMembers(activeGroup.id);
      if (currentUser) {
        fetchLedger(activeGroup.id, currentUser.id);
      }
    }
  }, [activeGroup, currentUser]);

  // --- API CALLS ---
  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/users`);
      const data = await res.json();
      setUsers(data);
      if (data.length > 0) {
        // Find Aisha to set as default current user
        const aisha = data.find(u => u.name === 'Aisha') || data[0];
        setCurrentUser(aisha);
      }
    } catch (e) {
      console.error('Error fetching users:', e);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await fetch(`${API_BASE}/groups`);
      const data = await res.json();
      setGroups(data);
      if (data.length > 0) {
        setActiveGroup(data[0]);
      }
    } catch (e) {
      console.error('Error fetching groups:', e);
    }
  };

  // --- ADD MEMBER / CREATE USER ---
  const handleCreateUser = async (password) => {
    if (!newUserName || newUserName.trim() === '') return null;
    try {
      if (password) {
        const res = await fetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newUserName.trim(), email: newUserEmail.trim() || undefined, password }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(`Failed to register: ${err.error}`);
          return null;
        }
        const { user, token: tok } = await res.json();
        if (tok) {
          setToken(tok);
          localStorage.setItem('token', tok);
        }
        await fetchUsers();
        setNewUserName('');
        setNewUserEmail('');
        setNewUserPassword('');
        return user;
      } else {
        const res = await fetch(`${API_BASE}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newUserName.trim(), email: newUserEmail.trim() || undefined }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(`Failed to create user: ${err.error}`);
          return null;
        }
        const user = await res.json();
        await fetchUsers();
        setNewUserName('');
        setNewUserEmail('');
        return user;
      }
    } catch (err) {
      console.error('Error creating user:', err);
      return null;
    }
  };

  const handleLogin = async ({ name, email, password }) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) { const err = await res.json(); alert(`Login failed: ${err.error}`); return null; }
      const { user, token: tok } = await res.json();
      if (tok) { setToken(tok); localStorage.setItem('token', tok); }
      await fetchUsers();
      return user;
    } catch (e) { console.error('Login error', e); return null; }
  };

  const handleAddMember = async (e) => {
    e && e.preventDefault();
    if (!activeGroup) return;

    let userIdToAdd = addMemberUserId;
    if (!userIdToAdd) {
      alert('Select a user or create a new one');
      return;
    }

    try {
      if (userIdToAdd === 'CREATE_NEW') {
        const created = await handleCreateUser();
        if (!created) return;
        userIdToAdd = String(created.id);
      }

      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/groups/${activeGroup.id}/members`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: parseInt(userIdToAdd, 10), joinedAt: addMemberJoinDate }),
      });

      if (res.ok) {
        setShowMemberModal(false);
        setAddMemberUserId('');
        await fetchGroupMembers(activeGroup.id);
        await fetchGroups();
      } else {
        const err = await res.json();
        alert(`Error adding member: ${err.error}`);
      }
    } catch (err) {
      console.error('Error adding member:', err);
      alert('Server error adding member');
    }
  };

  const fetchGroupMembers = async (groupId) => {
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}/members`);
      const data = await res.json();
      setGroupMembers(data);
      // Initialize participant selection with all active group members
      const initialParts = {};
      data.forEach(m => {
        initialParts[m.userId] = true;
      });
      setExpParticipants(initialParts);
    } catch (e) {
      console.error('Error fetching members:', e);
    }
  };

  const fetchBalances = async (groupId) => {
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}/balances`);
      const data = await res.json();
      setBalances(data.balances || []);
      setDebts(data.simplifiedDebts || []);
    } catch (e) {
      console.error('Error fetching balances:', e);
    }
  };

  const fetchLedger = async (groupId, userId) => {
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}/members/${userId}/ledger`);
      const data = await res.json();
      setLedgerItems(data || []);
    } catch (e) {
      console.error('Error fetching ledger:', e);
    }
  };

  const fetchImportReport = async () => {
    try {
      const res = await fetch(`${API_BASE}/import/report`);
      const data = await res.json();
      setImportReport(data || []);
    } catch (e) {
      console.error('Error fetching import report:', e);
    }
  };

  // --- MANUAL EXPENSE SUBMIT ---
  const handleCreateExpense = async (e) => {
    e.preventDefault();
    if (!activeGroup || !currentUser) return;

    const selectedParticipants = Object.keys(expParticipants)
      .filter(id => expParticipants[id])
      .map(Number);

    if (selectedParticipants.length === 0) {
      alert('Select at least one participant');
      return;
    }

    const payload = {
      groupId: activeGroup.id,
      description: expDesc,
      amount: parseFloat(expAmount),
      currency: expCurrency,
      date: expDate,
      paidById: parseInt(expPaidBy || currentUser.id, 10),
      splitType: expSplitType,
      participants: selectedParticipants,
      shares: selectedParticipants.map(id => expShares[id] || 0),
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/expenses`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowExpenseModal(false);
        fetchBalances(activeGroup.id);
        if (currentUser) fetchLedger(activeGroup.id, currentUser.id);
        // Reset form
        setExpDesc('');
        setExpAmount('');
        setExpSplitType('EQUAL');
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Server error creating expense');
    }
  };

  // --- MANUAL SETTLEMENT SUBMIT ---
  const handleCreateSettlement = async (e) => {
    e.preventDefault();
    if (!activeGroup) return;

    const payload = {
      groupId: activeGroup.id,
      fromUserId: parseInt(setFrom, 10),
      toUserId: parseInt(setTo, 10),
      amount: parseFloat(setAmount),
      currency: setCurrency,
      date: setDateVal,
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/settlements`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowSettlementModal(false);
        fetchBalances(activeGroup.id);
        if (currentUser) fetchLedger(activeGroup.id, currentUser.id);
        // Reset form
        setSetAmount('');
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- CSV UPLOAD & STAGING ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setCsvFile(file);
    }
  };

  const triggerAnalyzeCSV = () => {
    if (!csvFile) return;

    setImportStatus('analyzing');
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      try {
        const res = await fetch(`${API_BASE}/import/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvContent: text }),
        });

        if (res.ok) {
          const data = await res.json();
          setCsvData(data);
          
          // Pre-populate resolutions with default proposed fixes for all anomalies
          const initialResolutions = {};
          
          // Clean rows have no default resolution required (they are imported directly)
          // For anomaly rows, default action is "APPROVE" (apply proposedFix)
          data.anomalies.forEach(anomaly => {
            let proposed = {};
            try {
              proposed = JSON.parse(anomaly.proposedFix || '{}');
            } catch (e) {
              proposed = {};
            }

            initialResolutions[anomaly.csvRow] = {
              action: proposed.action === 'DELETE' ? 'DELETE' : 'APPROVE',
              anomalyId: anomaly.id,
              issueType: anomaly.issueType,
              message: anomaly.message,
              proposedFix: proposed,
            };
          });

          setResolutions(initialResolutions);
          setImportStatus('staging');
        } else {
          setImportStatus('error');
        }
      } catch (e) {
        console.error(e);
        setImportStatus('error');
      }
    };
    reader.readAsText(csvFile);
  };

  // --- RESOLUTION ACTION SETTERS ---
  const setRowResolutionAction = (rowNumber, action, customData = null) => {
    setResolutions(prev => {
      const current = prev[rowNumber] || {};
      const originalAnomaly = csvData.anomalies.find(a => a.csvRow === rowNumber);
      let proposed = {};
      try {
        proposed = JSON.parse(originalAnomaly?.proposedFix || '{}');
      } catch (e) {}

      return {
        ...prev,
        [rowNumber]: {
          ...current,
          action,
          anomalyId: originalAnomaly?.id,
          issueType: originalAnomaly?.issueType,
          message: originalAnomaly?.message,
          proposedFix: customData || current.proposedFix || proposed,
        }
      };
    });
  };

  // --- INLINE EDIT OF ANOMALY FORM ---
  const startEditingAnomaly = (row) => {
    setEditingRow(row.csvRow);
    const resolvedData = resolutions[row.csvRow]?.proposedFix || {};
    setEditFormData({
      id: row.id,
      date: resolvedData.date || row.date,
      description: resolvedData.description || row.description,
      amountStr: resolvedData.amountStr || row.amountStr,
      currency: resolvedData.currency || row.currency,
      paidBy: resolvedData.paidBy || row.paidBy,
      splitType: resolvedData.splitType || row.splitType,
      participantsStr: resolvedData.participantsStr || row.participantsStr,
      sharesStr: resolvedData.sharesStr || row.sharesStr,
      groupName: resolvedData.groupName || row.groupName,
      isSettlement: resolvedData.isSettlement || (row.description || '').toLowerCase().includes('settlement'),
    });
  };

  const handleSaveAnomalyEdit = (rowNumber) => {
    // Save editFormData as a custom resolved proposedFix and mark action as MODIFY
    setRowResolutionAction(rowNumber, 'MODIFY', editFormData);
    setEditingRow(null);
  };

  // --- FINAL INGESTION SUBMIT ---
  const handleFinalizeImport = async () => {
    setImportStatus('finalising');

    // Prepare finalized rows:
    // Iterate through all parsed rows and apply the resolutions
    const finalizedRows = [];
    const anomaliesLog = [];

    csvData.rows.forEach(row => {
      const resolution = resolutions[row.csvRow];

      if (resolution) {
        // There was an anomaly on this row
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
          issueType: resolution.issueType,
          message: resolution.message,
          resolvedStatus: resolution.action === 'IGNORE' ? 'IGNORED' : 'APPROVED',
          proposedFix: JSON.stringify(resolution.proposedFix),
        });

        if (resolution.action === 'IGNORE') {
          // Skip importing this row
          finalizedRows.push({
            ...row,
            action: 'SKIP',
          });
        } else if (resolution.action === 'DELETE') {
          finalizedRows.push({
            ...row,
            action: 'DELETE',
          });
        } else if (resolution.action === 'APPROVE') {
          // Apply proposed fix
          finalizedRows.push({
            ...row,
            ...resolution.proposedFix,
          });
        } else if (resolution.action === 'MODIFY') {
          // Apply custom user-modified data
          finalizedRows.push({
            ...row,
            ...resolution.proposedFix,
          });
        }
      } else {
        // Clean row: import as-is
        finalizedRows.push(row);
      }
    });

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/import/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          resolvedRows: finalizedRows,
          anomaliesLog,
        }),
      });

      if (res.ok) {
        setImportStatus('success');
        fetchGroups();
        fetchImportReport();
        setActiveTab('dashboard');
        setCsvFile(null);
        setCsvData(null);
      } else {
        setImportStatus('error');
      }
    } catch (e) {
      console.error(e);
      setImportStatus('error');
    }
  };

  // --- RENDER HELPERS ---
  const formatINR = (val) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(val);
  };

  const getPayerNameStr = (pId) => {
    const u = users.find(user => user.id === pId);
    return u ? u.name : 'Unknown';
  };

  return (
    <div className="app-container">
      {/* 1. Cyber-punk Header & Persona Authentication Selector */}
      <header className="navbar">
        <div className="navbar-logo pulse">
          <span>{`// DEBT.MINIMIZER.EXE`}</span>
        </div>
        
        <div className="flex-gap">
          <span className="font-mono text-muted text-xs">Logged Persona:</span>
          <select 
            className="form-select text-primary font-mono" 
            style={{ width: 'auto', border: '1px solid var(--primary)', padding: '0.3rem 0.5rem' }}
            value={currentUser ? currentUser.id : ''}
            onChange={(e) => {
              const u = users.find(usr => usr.id === parseInt(e.target.value, 10));
              setCurrentUser(u);
            }}
          >
            {users.map(usr => (
              <option key={usr.id} value={usr.id}>{usr.name} (View App)</option>
            ))}
          </select>
          <button className="btn" onClick={() => setShowUserModal(true)}>Sign In / Register</button>
        </div>
      </header>

      <div className="container">
        {/* Group Selection Area */}
        <div className="card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div className="flex-gap">
            <span className="font-mono text-muted">Active Group:</span>
            <div className="flex-gap">
              {groups.map(grp => (
                <button
                  key={grp.id}
                  className={`btn ${activeGroup?.id === grp.id ? 'btn-primary' : ''}`}
                  onClick={() => setActiveGroup(grp)}
                  style={{ padding: '0.4rem 0.8rem' }}
                >
                  {grp.name}
                </button>
              ))}
            </div>
          </div>

          {activeGroup && (
            <div className="flex-gap">
              <button className="btn btn-success" onClick={() => {
                // Initialize form payer with current user
                setExpPaidBy(String(currentUser?.id || ''));
                setShowExpenseModal(true);
              }}>
                + Add Expense
              </button>
              <button className="btn" onClick={() => setShowMemberModal(true)}>+ Add Member</button>
              <button className="btn btn-primary" onClick={() => {
                setSetFrom(String(currentUser?.id || ''));
                setShowSettlementModal(true);
              }}>
                + Record Settlement
              </button>
            </div>
          )}
        </div>

        {/* 2. Primary Tabs */}
        <div className="tabs-header">
          <button 
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
            onClick={() => setActiveTab('ledger')}
          >
            My Balance Ledger
          </button>
          <button 
            className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            Spreadsheet Import
          </button>
          <button 
            className={`tab-btn ${activeTab === 'report' ? 'active' : ''}`}
            onClick={() => setActiveTab('report')}
          >
            Anomaly History Log
          </button>
        </div>

        {/* --- TAB CONTENT: DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className="grid-2">
            {/* Left side: Aisha's Simplified Debts List */}
            <div className="card">
              <div className="card-header">
                <h3 className="pulse">Simplified Debts (Aisha's View)</h3>
                <span className="badge badge-primary">MIN.PAYMENTS</span>
              </div>
              <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                Peer-to-peer settlement plan that reduces the overall transaction overhead:
              </p>

              {debts.length === 0 ? (
                <div className="bg-success-dim font-mono" style={{ padding: '1rem', border: '1px solid var(--success)' }}>
                  {`>>> ALL DEBTS FULLY SETTLED. NO PAYMENTS OUTSTANDING.`}
                </div>
              ) : (
                <div className="flex-gap" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  {debts.map((debt, index) => (
                    <div 
                      key={index}
                      className="font-mono flex-between"
                      style={{ 
                        padding: '0.75rem', 
                        border: '1.5px solid var(--border-color)',
                        background: debt.fromId === currentUser?.id ? 'var(--bg-tertiary)' : 'transparent',
                        borderColor: debt.fromId === currentUser?.id ? 'var(--primary)' : 'var(--border-color)'
                      }}
                    >
                      <div>
                        <span className={debt.fromId === currentUser?.id ? 'text-primary' : 'text-main'}>
                          {debt.fromName}
                        </span>
                        <span className="text-muted"> owes </span>
                        <span className="text-success">{debt.toName}</span>
                      </div>
                      <div className="text-success font-bold" style={{ fontSize: '1.1rem' }}>
                        {formatINR(debt.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right side: Group Members Balances List */}
            <div className="card">
              <div className="card-header">
                <h3>Member Balances</h3>
                <span className="badge badge-primary">NET.SUMMARY</span>
              </div>
              <div className="table-container" style={{ boxShadow: 'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Total Paid</th>
                      <th>Total Owed</th>
                      <th>Net Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map(bal => {
                      const isCurrentUser = bal.userId === currentUser?.id;
                      const balVal = bal.balance;
                      const textClass = balVal > 0.05 ? 'text-success' : balVal < -0.05 ? 'text-error' : 'text-muted';
                      
                      return (
                        <tr key={bal.userId} style={{ borderLeft: isCurrentUser ? '3px solid var(--primary)' : 'none' }}>
                          <td style={{ fontWeight: isCurrentUser ? 'bold' : 'normal' }}>
                            {bal.userName} {isCurrentUser && <span className="text-primary">(You)</span>}
                          </td>
                          <td className="font-mono">{formatINR(bal.paid)}</td>
                          <td className="font-mono">{formatINR(bal.owed)}</td>
                          <td className={`font-mono font-bold ${textClass}`}>
                            {balVal > 0.05 ? '+' : ''}{formatINR(balVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB CONTENT: LEDGER (Rohan's View) --- */}
        {activeTab === 'ledger' && currentUser && (
          <div className="card">
            <div className="card-header flex-between">
              <div>
                <h3 className="pulse">Balance Ledger Audit Trail</h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  Showing Rohan's (and other flatmate's) granular splits contributing to their net balance.
                </p>
              </div>
              <span className="badge badge-primary font-mono">{currentUser.name}</span>
            </div>

            {ledgerItems.length === 0 ? (
              <p className="text-muted font-mono">{`>>> No expense items for this user.`}</p>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description / Details</th>
                      <th>Original Cost</th>
                      <th>Rate</th>
                      <th>Total (INR)</th>
                      <th>Paid (INR)</th>
                      <th>Owed (INR)</th>
                      <th>Net Impact</th>
                      <th>Running Bal.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerItems.map(item => {
                      const netVal = item.netImpact;
                      const runningVal = item.runningBalance;
                      
                      const netClass = netVal > 0.05 ? 'text-success' : netVal < -0.05 ? 'text-error' : 'text-muted';
                      const runClass = runningVal > 0.05 ? 'text-success' : runningVal < -0.05 ? 'text-error' : 'text-muted';

                      return (
                        <tr key={item.id} className={item.type === 'SETTLEMENT' ? 'bg-success-dim' : ''}>
                          <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>
                            {new Date(item.date).toISOString().split('T')[0]}
                          </td>
                          <td>
                            <div className="font-bold">{item.description}</div>
                            <div className="text-xs text-muted" style={{ marginTop: '0.1rem' }}>
                              {item.details}
                            </div>
                          </td>
                          <td className="font-mono">
                            {item.originalAmount} {item.originalCurrency}
                          </td>
                          <td className="font-mono text-muted">{item.exchangeRate.toFixed(2)}</td>
                          <td className="font-mono">{formatINR(item.amountInINR)}</td>
                          <td className="font-mono text-success">
                            {item.userPaidInINR > 0 ? formatINR(item.userPaidInINR) : '—'}
                          </td>
                          <td className="font-mono text-error">
                            {item.userOwedInINR > 0 ? formatINR(item.userOwedInINR) : '—'}
                          </td>
                          <td className={`font-mono font-bold ${netClass}`}>
                            {netVal > 0.05 ? '+' : ''}{formatINR(netVal)}
                          </td>
                          <td className={`font-mono font-bold ${runClass}`}>
                            {formatINR(runningVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* --- TAB CONTENT: SPREADSHEET IMPORT (Meera's View) --- */}
        {activeTab === 'import' && (
          <div className="card">
            <div className="card-header">
              <h3>Ingest CSV spreadsheet</h3>
              <span className="badge badge-warning">MEERA.APPROVAL</span>
            </div>

            {importStatus === 'idle' && (
              <div style={{ textAlign: 'center', padding: '3rem 1.5rem', border: '2px dashed var(--border-color)', background: 'var(--bg-tertiary)' }}>
                <span className="font-mono text-muted block" style={{ marginBottom: '1rem', display: 'block' }}>
                  {`>>> Select expenses_export.csv containing historical tracker data`}
                </span>
                <input 
                  type="file" 
                  accept=".csv" 
                  id="csv-file-picker" 
                  onChange={handleFileUpload} 
                  style={{ display: 'none' }} 
                />
                <label 
                  htmlFor="csv-file-picker" 
                  className="btn btn-primary" 
                  style={{ marginRight: '1rem' }}
                >
                  Choose File
                </label>
                
                {csvFile && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <span className="font-mono text-primary block" style={{ display: 'block', marginBottom: '1rem' }}>
                      Selected: {csvFile.name} ({(csvFile.size / 1024).toFixed(2)} KB)
                    </span>
                    <button className="btn btn-success" onClick={triggerAnalyzeCSV}>
                      Analyze Spreadsheet Anomalies
                    </button>
                  </div>
                )}
              </div>
            )}

            {importStatus === 'analyzing' && (
              <div className="font-mono" style={{ padding: '2rem', textAlign: 'center' }}>
                <span className="pulse text-primary font-bold">ANALYZING LOG DATA FOR ANOMALIES... PLEASE STAND BY</span>
              </div>
            )}

            {importStatus === 'finalising' && (
              <div className="font-mono" style={{ padding: '2rem', textAlign: 'center' }}>
                <span className="pulse text-success font-bold">INGESTING AND MERGING TRACKER DATA TRANSACTIONALLY...</span>
              </div>
            )}

            {/* Ingest Review Staging Dashboard (Meera's Controls) */}
            {importStatus === 'staging' && csvData && (
              <div>
                <div className="bg-danger-dim font-mono" style={{ padding: '1rem', border: '1px solid var(--error)', marginBottom: '1.5rem' }}>
                  <h4 className="text-error font-bold">ANOMALY LOG WARNING: IDENTIFIED {csvData.anomalies.length} CONFLICTS</h4>
                  <p className="text-muted text-xs" style={{ marginTop: '0.2rem' }}>
                    Meera's Directive: Review and approve standard fixes, ignore row, or manually modify entries before committing to DB.
                  </p>
                </div>

                <div className="table-container" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Row #</th>
                        <th>Anomaly Type & Details</th>
                        <th>Original CSV Values</th>
                        <th>Proposed Action / Resolved Values</th>
                        <th>Controls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.anomalies.map(anomaly => {
                        const rowNum = anomaly.csvRow;
                        const res = resolutions[rowNum] || {};
                        const isEditing = editingRow === rowNum;
                        
                        return (
                          <tr key={anomaly.id} className={res.action === 'IGNORE' ? 'bg-danger-dim text-muted' : ''}>
                            <td className="font-mono font-bold text-center">{rowNum}</td>
                            <td>
                              <span className="badge badge-error" style={{ marginBottom: '0.3rem' }}>
                                {anomaly.issueType}
                              </span>
                              <div className="text-xs">{anomaly.message}</div>
                            </td>
                            <td className="font-mono text-xs text-muted">
                              <div>ID: {anomaly.csvId} | Date: {anomaly.date}</div>
                              <div>Desc: {anomaly.description}</div>
                              <div>Amount: {anomaly.amount} {anomaly.currency} | Paid By: {anomaly.paidBy}</div>
                              <div>Split: {anomaly.splitType} | Parts: {anomaly.participants}</div>
                              {anomaly.shares && <div>Shares: {anomaly.shares}</div>}
                            </td>
                            <td>
                              {isEditing ? (
                                <div className="card" style={{ padding: '0.75rem', boxShadow: 'none', background: 'var(--bg-tertiary)', border: '1px solid var(--primary)', minWidth: '250px' }}>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Date</label>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.date}
                                      onChange={(e) => setEditFormData({ ...editFormData, date: e.target.value })}
                                    />
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Description</label>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.description}
                                      onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                                    />
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Amount</label>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.amountStr}
                                      onChange={(e) => setEditFormData({ ...editFormData, amountStr: e.target.value })}
                                    />
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Currency</label>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.currency}
                                      onChange={(e) => setEditFormData({ ...editFormData, currency: e.target.value })}
                                    />
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Payer</label>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.paidBy}
                                      onChange={(e) => setEditFormData({ ...editFormData, paidBy: e.target.value })}
                                    />
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Split Type</label>
                                    <select 
                                      className="form-select" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.splitType}
                                      onChange={(e) => setEditFormData({ ...editFormData, splitType: e.target.value })}
                                    >
                                      <option value="EQUAL">EQUAL</option>
                                      <option value="PERCENTAGE">PERCENTAGE</option>
                                      <option value="EXACT">EXACT</option>
                                    </select>
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Participants</label>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.participantsStr}
                                      onChange={(e) => setEditFormData({ ...editFormData, participantsStr: e.target.value })}
                                    />
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                    <label className="form-label text-xs">Shares</label>
                                    <input 
                                      type="text" 
                                      className="form-input" 
                                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                                      value={editFormData.sharesStr}
                                      onChange={(e) => setEditFormData({ ...editFormData, sharesStr: e.target.value })}
                                    />
                                  </div>
                                  <div className="form-group" style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={editFormData.isSettlement}
                                      onChange={(e) => setEditFormData({ ...editFormData, isSettlement: e.target.checked })}
                                    />
                                    <label className="form-label" style={{ marginBottom: 0 }}>Is Settlement</label>
                                  </div>

                                  <div className="flex-gap" style={{ marginTop: '0.5rem' }}>
                                    <button className="btn btn-success" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleSaveAnomalyEdit(rowNum)}>Save</button>
                                    <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setEditingRow(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="font-mono text-xs">
                                  <div className="text-primary font-bold">Action: {res.action}</div>
                                  {res.action === 'APPROVE' && (
                                    <div className="text-success">
                                      {res.proposedFix.action === 'DELETE' ? (
                                        '>>> ROW DELETED (Duplicate)'
                                      ) : res.proposedFix.action === 'SKIP' ? (
                                        '>>> ROW SKIPPED (Zero Cost/Personal)'
                                      ) : (
                                        <>
                                          <div>Date: {res.proposedFix.date} | Desc: {res.proposedFix.description}</div>
                                          <div>Amount: {res.proposedFix.amountStr || res.proposedFix.amount} {res.proposedFix.currency}</div>
                                          <div>Paid By: {res.proposedFix.paidBy} | Split: {res.proposedFix.splitType}</div>
                                          <div>Parts: {res.proposedFix.participantsStr}</div>
                                          {res.proposedFix.sharesStr && <div>Shares: {res.proposedFix.sharesStr}</div>}
                                          {res.proposedFix.isSettlement && <div className="text-warning">Importing as SETTLEMENT record</div>}
                                          {res.proposedFix.isRefund && <div className="text-warning">Importing as REFUND (inverted splits)</div>}
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {res.action === 'MODIFY' && (
                                    <div className="text-warning">
                                      <div>Date: {res.proposedFix.date} | Desc: {res.proposedFix.description}</div>
                                      <div>Amount: {res.proposedFix.amountStr} {res.proposedFix.currency}</div>
                                      <div>Paid By: {res.proposedFix.paidBy} | Split: {res.proposedFix.splitType}</div>
                                      <div>Parts: {res.proposedFix.participantsStr}</div>
                                      {res.proposedFix.sharesStr && <div>Shares: {res.proposedFix.sharesStr}</div>}
                                      {res.proposedFix.isSettlement && <div>Importing as SETTLEMENT</div>}
                                    </div>
                                  )}
                                  {res.action === 'IGNORE' && (
                                    <div className="text-error">{`>>> ROW SKIPPED`}</div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>
                              {!isEditing && (
                                <div className="flex-gap" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                  <button 
                                    className={`btn ${res.action === 'APPROVE' || res.action === 'DELETE' ? 'btn-success' : ''}`}
                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                    onClick={() => setRowResolutionAction(rowNum, anomaly.proposedFix && JSON.parse(anomaly.proposedFix).action === 'DELETE' ? 'DELETE' : 'APPROVE')}
                                  >
                                    {anomaly.proposedFix && JSON.parse(anomaly.proposedFix).action === 'DELETE' ? 'Approve Delete' : 'Approve Fix'}
                                  </button>
                                  <button 
                                    className={`btn ${res.action === 'IGNORE' ? 'btn-danger' : ''}`}
                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                    onClick={() => setRowResolutionAction(rowNum, 'IGNORE')}
                                  >
                                    Ignore/Skip
                                  </button>
                                  <button 
                                    className="btn btn-primary"
                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                    onClick={() => startEditingAnomaly(anomaly)}
                                  >
                                    Modify
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex-between" style={{ marginTop: '1.5rem' }}>
                  <button className="btn btn-danger" onClick={() => setImportStatus('idle')}>
                    Cancel Import
                  </button>
                  <button className="btn btn-success" onClick={handleFinalizeImport}>
                    Confirm & Finalize Ingestion
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- TAB CONTENT: ANOMALY HISTORY LOG --- */}
        {activeTab === 'report' && (
          <div className="card">
            <div className="card-header">
              <h3>Ingestion Audit Report</h3>
              <span className="badge badge-success">REPORT.LOG</span>
            </div>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Granular record of all data problems detected during the last CSV spreadsheet import and the resolution actions taken:
            </p>

            {importReport.length === 0 ? (
              <p className="text-muted font-mono">{`>>> No records in the import log database.`}</p>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Original ID</th>
                      <th>Original Payer / Desc</th>
                      <th>Anomaly Category</th>
                      <th>Detailed Detection Message</th>
                      <th>Status</th>
                      <th>Resolution Fix Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importReport.map(log => (
                      <tr key={log.id} className={log.resolvedStatus === 'IGNORED' ? 'bg-danger-dim text-muted' : ''}>
                        <td className="font-mono font-bold text-center">{log.csvRow}</td>
                        <td className="font-mono">{log.csvId || '—'}</td>
                        <td>
                          <div className="font-bold">{log.description || '—'}</div>
                          <div className="text-xs text-muted">Paid by {log.paidBy || '—'} ({log.amount} {log.currency})</div>
                        </td>
                        <td>
                          <span className="badge badge-error">{log.issueType}</span>
                        </td>
                        <td className="text-xs">{log.message}</td>
                        <td className="font-mono">
                          <span className={`badge ${log.resolvedStatus === 'APPROVED' ? 'badge-success' : 'badge-error'}`}>
                            {log.resolvedStatus}
                          </span>
                        </td>
                        <td className="font-mono text-xs">
                          {log.proposedFix ? (
                            <pre style={{ overflowX: 'auto', maxWidth: '200px', margin: 0 }}>
                              {JSON.stringify(JSON.parse(log.proposedFix), null, 2)}
                            </pre>
                          ) : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- MODAL: ADD EXPENSE --- */}
      {showExpenseModal && activeGroup && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleCreateExpense}>
            <div className="modal-header">
              <h3>Add Shared Expense</h3>
              <button type="button" className="btn" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setShowExpenseModal(false)}>X</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Description</label>
                <input 
                  type="text" 
                  className="form-input" 
                  required 
                  value={expDesc} 
                  onChange={(e) => setExpDesc(e.target.value)} 
                />
              </div>

              <div className="grid-2" style={{ gap: '1rem', marginBottom: '1.25rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Amount</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className="form-input" 
                    required 
                    value={expAmount} 
                    onChange={(e) => setExpAmount(e.target.value)} 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Currency</label>
                  <select className="form-select" value={expCurrency} onChange={(e) => setExpCurrency(e.target.value)}>
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>

              <div className="grid-2" style={{ gap: '1rem', marginBottom: '1.25rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Date</label>
                  <input 
                    type="date" 
                    className="form-input" 
                    required 
                    value={expDate} 
                    onChange={(e) => setExpDate(e.target.value)} 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Paid By</label>
                  <select className="form-select" value={expPaidBy} onChange={(e) => setExpPaidBy(e.target.value)}>
                    {groupMembers.map(m => (
                      <option key={m.userId} value={m.userId}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Split Type</label>
                <select className="form-select" value={expSplitType} onChange={(e) => setExpSplitType(e.target.value)}>
                  <option value="EQUAL">EQUAL (Split evenly)</option>
                  <option value="PERCENTAGE">PERCENTAGE (Specify %)</option>
                  <option value="EXACT">EXACT (Specify absolute share)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Participants & Custom Shares</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--bg-tertiary)', padding: '0.75rem', border: '1px solid var(--border-color)' }}>
                  {groupMembers.map(m => (
                    <div key={m.userId} className="flex-between font-mono text-sm">
                      <div className="flex-gap">
                        <input 
                          type="checkbox" 
                          checked={!!expParticipants[m.userId]} 
                          onChange={(e) => setExpParticipants({
                            ...expParticipants,
                            [m.userId]: e.target.checked
                          })}
                        />
                        <span>{m.name}</span>
                      </div>
                      
                      {expParticipants[m.userId] && expSplitType !== 'EQUAL' && (
                        <div className="flex-gap">
                          <input 
                            type="number" 
                            step="0.01" 
                            className="form-input" 
                            style={{ width: '80px', padding: '0.2rem 0.4rem', textAlign: 'right' }}
                            placeholder={expSplitType === 'PERCENTAGE' ? '%' : 'Cost'}
                            value={expShares[m.userId] || ''}
                            onChange={(e) => setExpShares({
                              ...expShares,
                              [m.userId]: e.target.value
                            })}
                          />
                          <span>{expSplitType === 'PERCENTAGE' ? '%' : 'INR'}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setShowExpenseModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-success">Save Expense</button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL: ADD MEMBER --- */}
      {showMemberModal && activeGroup && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleAddMember}>
            <div className="modal-header">
              <h3>Add Member to {activeGroup.name}</h3>
              <button type="button" className="btn" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setShowMemberModal(false)}>X</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Select Existing User</label>
                <select className="form-select" value={addMemberUserId} onChange={(e) => setAddMemberUserId(e.target.value)}>
                  <option value="">-- Select user --</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email || 'no-email'})</option>
                  ))}
                  <option value="CREATE_NEW">+ Create new user...</option>
                </select>
              </div>

              {addMemberUserId === 'CREATE_NEW' && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">New User Name</label>
                    <input className="form-input" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">New User Email (optional)</label>
                    <input className="form-input" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label className="form-label">Join Date</label>
                <input type="date" className="form-input" value={addMemberJoinDate} onChange={(e) => setAddMemberJoinDate(e.target.value)} />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setShowMemberModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Member</button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL: SIGN IN / REGISTER --- */}
      {showUserModal && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={async (e) => {
            e.preventDefault();
            if (loginUserId && loginUserId !== 'CREATE_NEW') {
              // Login existing user by prompting for password
              const selected = users.find(x => x.id === parseInt(loginUserId, 10));
              if (!selected) { alert('Select a valid user'); return; }
              const pw = prompt('Enter password for ' + selected.name + ' (for demo only)');
              if (!pw) { alert('Password required'); return; }
              const logged = await handleLogin({ name: selected.name, password: pw });
              if (logged) setCurrentUser(logged);
              setShowUserModal(false);
              return;
            }
            // CREATE_NEW flow - require name and password
            if (!newUserName || newUserName.trim() === '') { alert('Enter a name'); return; }
            if (!newUserPassword || newUserPassword.length < 4) { alert('Enter a password (min 4 chars)'); return; }
            const created = await handleCreateUser(newUserPassword);
            if (created) setCurrentUser(created);
            setShowUserModal(false);
          }}>
            <div className="modal-header">
              <h3>Sign In / Register</h3>
              <button type="button" className="btn" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setShowUserModal(false)}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Choose existing user</label>
                <select className="form-select" value={loginUserId} onChange={(e) => setLoginUserId(e.target.value)}>
                  <option value="">-- Select --</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  <option value="CREATE_NEW">+ Create new account...</option>
                </select>
              </div>
              {loginUserId === 'CREATE_NEW' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email (optional)</label>
                    <input className="form-input" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input type="password" className="form-input" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setShowUserModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Sign In</button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL: RECORD SETTLEMENT --- */}
      {showSettlementModal && activeGroup && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleCreateSettlement}>
            <div className="modal-header">
              <h3>Record Settlement / Payment</h3>
              <button type="button" className="btn" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setShowSettlementModal(false)}>X</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Sender (Payer)</label>
                <select className="form-select" value={setFrom} onChange={(e) => setSetFrom(e.target.value)}>
                  {groupMembers.map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Recipient (Paid To)</label>
                <select className="form-select" value={setTo} onChange={(e) => setSetTo(e.target.value)}>
                  <option value="">-- Select Recipient --</option>
                  {groupMembers.map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid-2" style={{ gap: '1rem', marginBottom: '1.25rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Amount</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className="form-input" 
                    required 
                    value={setAmount} 
                    onChange={(e) => setSetAmount(e.target.value)} 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Currency</label>
                  <select className="form-select" value={setCurrency} onChange={(e) => setSetCurrency(e.target.value)}>
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Date</label>
                <input 
                  type="date" 
                  className="form-input" 
                  required 
                  value={setDateVal} 
                  onChange={(e) => setSetDateVal(e.target.value)} 
                />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setShowSettlementModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Record Payment</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
