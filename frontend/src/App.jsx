import { useMemo, useRef, useState } from "react";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatMoney(n) {
  if (n == null || n === "") return "—";
  return inr.format(Number(n));
}

export default function App() {
  const [tab, setTab] = useState("statement");
  const [txns, setTxns] = useState([]);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  const [host, setHost] = useState("http://localhost:9000");
  const [company, setCompany] = useState("");
  const [companies, setCompanies] = useState([]);
  const [ledgers, setLedgers] = useState([]);
  const [bankLedger, setBankLedger] = useState("");
  const [defaultParty, setDefaultParty] = useState("Suspense");

  const totals = useMemo(() => {
    const credits = txns.reduce((s, t) => s + Number(t.credit || 0), 0);
    const debits = txns.reduce((s, t) => s + Number(t.debit || 0), 0);
    return { credits, debits, net: credits - debits, n: txns.length };
  }, [txns]);

  async function parseFile(file) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Parse failed");
      setTxns(data.transactions || []);
      setMeta(data);
      setTab("statement");
      setMsg({
        kind: "ok",
        text: `Parsed ${data.count || 0} transactions from ${file.name} (${data.source}).`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function downloadExcel() {
    setBusy(true);
    try {
      const res = await fetch("/api/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: txns }),
      });
      if (!res.ok) throw new Error("Excel export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bank-statement.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function connectTally() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tally/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Connection failed");
      setCompanies(data.companies || []);
      if (data.companies?.length && !company) setCompany(data.companies[0]);
      setMsg({
        kind: "ok",
        text: data.companies?.length
          ? `Connected. Found ${data.companies.length} company(ies).`
          : "Connected to Tally gateway. Open a company in Tally if the list is empty.",
      });
    } catch (e) {
      setMsg({ kind: "err", text: String(e.message) });
    } finally {
      setBusy(false);
    }
  }

  async function loadLedgers() {
    setBusy(true);
    try {
      const res = await fetch("/api/tally/ledgers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not load ledgers");
      setLedgers(data.ledgers || []);
      setMsg({ kind: "ok", text: `Loaded ${data.ledgers?.length || 0} ledgers.` });
    } catch (e) {
      setMsg({ kind: "err", text: String(e.message) });
    } finally {
      setBusy(false);
    }
  }

  async function postToTally() {
    if (!bankLedger) {
      setMsg({ kind: "err", text: "Choose the bank ledger in Tally first." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tally/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          company,
          bank_ledger: bankLedger,
          default_party_ledger: defaultParty,
          transactions: txns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Post failed");
      setMsg({
        kind: data.exceptions ? "err" : "ok",
        text: `Posted ${data.posted} vouchers — created ${data.created}, altered ${data.altered}, exceptions ${data.exceptions}. ${data.message || ""}`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: String(e.message) });
    } finally {
      setBusy(false);
    }
  }

  function updateTxn(i, patch) {
    setTxns((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  return (
    <div className="shell">
      <nav className="top">
        <div className="brand">
          <div className="mark">₹</div>
          LedgerLink
        </div>
        <div className="nav-links">
          <a href="#workspace">Convert</a>
          <a href="#tally">Tally</a>
          <a href="#how">How it works</a>
        </div>
      </nav>

      <section className="hero">
        <div>
          <div className="kicker">Bank PDF / Excel / CSV → clean books</div>
          <h1>Turn bank statements into Excel — then post them into Tally.</h1>
          <p className="lead">
            Built for Indian businesses on TallyPrime. Parse messy statements, download a
            formatted workbook, map ledgers, and push Receipt & Payment vouchers over
            Tally’s XML gateway.
          </p>
          <div className="cta-row">
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              Upload statement
            </button>
            <button className="btn btn-ghost" onClick={() => setTab("tally")}>
              Connect Tally
            </button>
          </div>
        </div>
        <div className="hero-card">
          <div className="mini-row">
            <span>HDFC / ICICI / SBI / Axis CSV</span>
            <span className="pill">Supported</span>
          </div>
          <div className="mini-row">
            <span>Excel (.xlsx) & scanned-layout PDF tables</span>
            <span className="pill">Parser</span>
          </div>
          <div className="mini-row">
            <span>TallyPrime XML on port 9000</span>
            <span className="pill">Live</span>
          </div>
          <div className="mini-row">
            <span>Receipt & Payment vouchers</span>
            <span className="pill warn">Maps ledgers</span>
          </div>
        </div>
      </section>

      <div className="grid-3" id="how">
        <div className="tile">
          <div className="step">1</div>
          <h3>Drop the statement</h3>
          <p>We detect date, narration, debit/credit columns from common Indian bank layouts.</p>
        </div>
        <div className="tile">
          <div className="step">2</div>
          <h3>Clean Excel</h3>
          <p>Download a formatted sheet with totals, types, and a suggested Tally ledger.</p>
        </div>
        <div className="tile">
          <div className="step">3</div>
          <h3>Post to Tally</h3>
          <p>Point at your Tally gateway, pick the bank ledger, and import vouchers in one shot.</p>
        </div>
      </div>

      <div className="workspace" id="workspace">
        <div className="ws-head">
          <div>
            <h2>Workspace</h2>
            <p>Parse locally on this server. Tally stays on your PC — we only send XML you approve.</p>
          </div>
          <div className="tabs">
            <button className={`tab ${tab === "statement" ? "on" : ""}`} onClick={() => setTab("statement")}>
              Statement
            </button>
            <button className={`tab ${tab === "tally" ? "on" : ""}`} onClick={() => setTab("tally")} id="tally">
              Tally connect
            </button>
          </div>
        </div>
        <div className="ws-body">
          {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

          {tab === "statement" && (
            <>
              <div
                className={`drop ${over ? "over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  parseFile(e.dataTransfer.files[0]);
                }}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.pdf,.txt"
                  onChange={(e) => parseFile(e.target.files?.[0])}
                />
                <strong>{busy ? "Reading statement…" : "Drop CSV, Excel or PDF here"}</strong>
                <p className="help" style={{ marginTop: 8 }}>
                  Tip: bank CSV exports work best. PDFs need a proper transaction table.
                </p>
              </div>

              <div className="stats">
                <div className="stat">
                  <b>{totals.n}</b>
                  <span>Transactions</span>
                </div>
                <div className="stat">
                  <b>{formatMoney(totals.credits)}</b>
                  <span>Credits / receipts</span>
                </div>
                <div className="stat">
                  <b>{formatMoney(totals.debits)}</b>
                  <span>Debits / payments</span>
                </div>
                <div className="stat">
                  <b>{formatMoney(totals.net)}</b>
                  <span>Net movement</span>
                </div>
              </div>

              <div className="actions">
                <button className="btn btn-primary" disabled={!txns.length || busy} onClick={downloadExcel}>
                  Download Excel
                </button>
                <button className="btn btn-ghost" disabled={!txns.length} onClick={() => setTab("tally")}>
                  Send to Tally →
                </button>
              </div>

              {txns.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Narration</th>
                        <th className="money">Debit</th>
                        <th className="money">Credit</th>
                        <th>Type</th>
                        <th>Tally ledger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txns.map((t, i) => (
                        <tr key={i}>
                          <td>{t.date}</td>
                          <td>
                            {t.description}
                            {t.reference ? <div className="help">{t.reference}</div> : null}
                          </td>
                          <td className="money dr">{t.debit ? formatMoney(t.debit) : ""}</td>
                          <td className="money cr">{t.credit ? formatMoney(t.credit) : ""}</td>
                          <td>{t.type}</td>
                          <td>
                            <input
                              type="text"
                              value={t.party_ledger ?? t.suggested_ledger ?? ""}
                              onChange={(e) => updateTxn(i, { party_ledger: e.target.value })}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === "tally" && (
            <>
              <p className="help">
                On the PC where TallyPrime is running: press <code>F12</code> → Advanced
                Configuration → set <strong>TallyPrime is acting as</strong> to Both / Server,
                port <code>9000</code>, and enable XML. Keep the company open.
              </p>
              <div className="form-grid" style={{ marginTop: 16 }}>
                <label className="field">
                  <span>Tally gateway URL</span>
                  <input
                    type="url"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="http://localhost:9000"
                  />
                </label>
                <label className="field">
                  <span>Company</span>
                  {companies.length ? (
                    <select value={company} onChange={(e) => setCompany(e.target.value)}>
                      {companies.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Exact company name as in Tally"
                    />
                  )}
                </label>
                <label className="field">
                  <span>Bank ledger</span>
                  {ledgers.length ? (
                    <select value={bankLedger} onChange={(e) => setBankLedger(e.target.value)}>
                      <option value="">Select bank ledger…</option>
                      {ledgers.map((l) => (
                        <option key={l.name} value={l.name}>
                          {l.name}
                          {l.parent ? ` · ${l.parent}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={bankLedger}
                      onChange={(e) => setBankLedger(e.target.value)}
                      placeholder="e.g. HDFC Bank"
                    />
                  )}
                </label>
                <label className="field">
                  <span>Default opposite ledger</span>
                  <input
                    type="text"
                    value={defaultParty}
                    onChange={(e) => setDefaultParty(e.target.value)}
                    placeholder="Suspense"
                  />
                </label>
              </div>
              <div className="actions">
                <button className="btn btn-primary" disabled={busy} onClick={connectTally}>
                  Test connection
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={loadLedgers}>
                  Load ledgers
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !txns.length}
                  onClick={postToTally}
                >
                  Post {txns.length} vouchers
                </button>
              </div>
              <div className="banner info">
                Credits become <strong>Receipt</strong> vouchers (Bank Dr / party Cr). Debits
                become <strong>Payment</strong> vouchers. Edit the ledger column on Statement
                before posting. This preview cannot reach your office Tally unless the gateway
                URL is publicly reachable — run Tally on the same machine as the API for a
                real import.
              </div>
            </>
          )}
        </div>
      </div>

      <footer>
        LedgerLink · Bank statement to Excel & Tally XML · Not affiliated with Tally Solutions
      </footer>
    </div>
  );
}
