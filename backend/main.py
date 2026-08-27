from __future__ import annotations

import os
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from parser import parse_statement, transactions_to_xlsx
from tally import (
    TallyError,
    envelope_export,
    envelope_import,
    parse_companies,
    parse_import_result,
    parse_ledgers,
    post_xml,
    voucher_xml,
)

app = FastAPI(title="Bank Statement → Excel & Tally", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TallyConfig(BaseModel):
    host: str = Field(default="http://localhost:9000")
    company: str = ""


class ConnectBody(TallyConfig):
    pass


class PostBody(BaseModel):
    host: str = "http://localhost:9000"
    company: str = ""
    bank_ledger: str
    default_party_ledger: str = "Suspense"
    transactions: list[dict]


def tally_company_var(company: str) -> str:
    if not company:
        return ""
    return f"<SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>"


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "bank-statement-to-excel"}


@app.post("/api/parse")
async def parse(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        result = parse_statement(file.filename or "statement.csv", raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not parse statement: {exc}") from exc
    return result


@app.post("/api/export-excel")
async def export_excel(payload: dict):
    txns = payload.get("transactions") or []
    data = transactions_to_xlsx(txns)
    stamp = datetime.now().strftime("%Y%m%d")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="bank-statement-{stamp}.xlsx"'},
    )


@app.post("/api/tally/connect")
async def tally_connect(body: ConnectBody):
    xml = envelope_export("List of Companies")
    try:
        raw = await post_xml(body.host, xml)
    except TallyError as exc:
        raise HTTPException(502, str(exc)) from exc
    companies = parse_companies(raw)
    return {"ok": True, "companies": companies, "rawPreview": raw[:500]}


@app.post("/api/tally/ledgers")
async def tally_ledgers(body: ConnectBody):
    extra = tally_company_var(body.company)
    xml = envelope_export("List of Accounts", extra)
    try:
        raw = await post_xml(body.host, xml)
    except TallyError as exc:
        raise HTTPException(502, str(exc)) from exc
    ledgers = parse_ledgers(raw)
    return {"ok": True, "ledgers": ledgers}


@app.post("/api/tally/post")
async def tally_post(body: PostBody):
    if not body.transactions:
        raise HTTPException(400, "No transactions to post")
    messages = []
    for t in body.transactions:
        if t.get("skip"):
            continue
        date = (t.get("date") or "").replace("-", "")
        if len(date) != 8:
            date = datetime.now().strftime("%Y%m%d")
        amount = abs(float(t.get("amount") or t.get("credit") or t.get("debit") or 0))
        if amount == 0:
            continue
        is_receipt = (t.get("type") == "receipt") or float(t.get("credit") or 0) > 0
        vch_type = t.get("voucher_type") or ("Receipt" if is_receipt else "Payment")
        party = t.get("party_ledger") or t.get("suggested_ledger") or body.default_party_ledger
        messages.append(
            voucher_xml(
                date_yyyymmdd=date,
                vch_type=vch_type,
                narration=t.get("description") or "",
                amount=amount,
                bank_ledger=body.bank_ledger,
                party_ledger=party,
                is_receipt=is_receipt,
            )
        )
    inner = "<REQUESTDATA>" + "".join(messages) + "</REQUESTDATA>"
    xml = envelope_import(inner)
    try:
        raw = await post_xml(body.host, xml)
    except TallyError as exc:
        raise HTTPException(502, str(exc)) from exc
    result = parse_import_result(raw)
    result["posted"] = len(messages)
    return result


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
