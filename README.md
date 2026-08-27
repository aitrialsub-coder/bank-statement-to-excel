# LedgerLink — Bank statement to Excel & Tally

**Open source (MIT).** Convert Indian bank statements (CSV / Excel / PDF) into a clean Excel workbook and post Receipt / Payment vouchers into **TallyPrime** over the XML gateway.

- **Source:** https://github.com/aitrialsub-coder/bank-statement-to-excel
- **License:** [MIT](LICENSE)

> Tally must run on *your* PC (port 9000). A hosted demo cannot reach your company data.

## Quick start (local — this is how Tally actually works)

```bash
git clone https://github.com/aitrialsub-coder/bank-statement-to-excel.git
cd bank-statement-to-excel

python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
python backend/main.py      # API → http://localhost:8000
```

In another terminal:

```bash
cd frontend
npm install
npm run dev                 # UI → http://localhost:5173
```

Open **http://localhost:5173**

1. Drop `sample-hdfc.csv` (or your bank CSV).
2. **Download Excel**.
3. Open TallyPrime → `F12` → Advanced Configuration → acting as **Both/Server**, port **9000**.
4. Tab **Tally connect** → Test connection → Load ledgers → Post vouchers.

## API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/parse` | Upload statement |
| POST | `/api/export-excel` | Download `.xlsx` |
| POST | `/api/tally/connect` | List companies |
| POST | `/api/tally/ledgers` | List ledgers |
| POST | `/api/tally/post` | Import vouchers |

Not affiliated with Tally Solutions Pvt. Ltd.
